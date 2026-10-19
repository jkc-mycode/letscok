import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IHistoryMemberGame,
  IHistoryMemberSessionPage,
  IHistoryMemberStats,
  IHistoryRankingEntry,
  IHistorySessionDetail,
  IHistorySessionListResponse,
} from '@letscok/shared-types';
import { toDateString } from '../common/utils/date.util';
import { memberAttendanceStats } from '../common/utils/member-stats';
import { withSlots } from '../common/utils/game-slots';
import { PrismaService } from '../prisma/prisma.service';

// 히스토리/전적 조회 — 전부 읽기 전용. 이미 쌓인 데이터의 집계라 사전 집계 테이블 없이
// 조회 시 계산한다 (주 1~2회 모임 × 수십 명 규모 — 느려지면 그때 측정 후 도입)
@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  // 지난 모임 목록 — 종료(CLOSED)된 세션만, 최신순
  async listSessions(page: number, limit: number): Promise<IHistorySessionListResponse> {
    const [sessions, total] = await Promise.all([
      this.prisma.session.findMany({
        where: { status: 'CLOSED' },
        orderBy: [{ date: 'desc' }, { openedAt: 'desc' }], // 같은 날 두 모임은 2부가 위로
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              attendances: true,
              games: { where: { status: 'FINISHED' } }, // CANCELED는 없던 게임 취급
            },
          },
        },
      }),
      this.prisma.session.count({ where: { status: 'CLOSED' } }),
    ]);

    const parts = await this.dayParts(sessions);
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        date: toDateString(session.date),
        part: parts.get(session.id) ?? null,
        attendeeCount: session._count.attendances,
        finishedGameCount: session._count.games,
      })),
      total,
      page,
      limit,
    };
  }

  // 모임 상세 — 출석자(그날 많이 뛴 순) + 완료 게임 목록(시작 시각 순)
  async getSessionDetail(id: string): Promise<IHistorySessionDetail> {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        _count: {
          select: { attendances: true, games: { where: { status: 'FINISHED' } } },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('모임 기록을 찾을 수 없습니다.');
    }

    const [attendances, games] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { sessionId: id },
        include: { member: true },
        orderBy: { gamesPlayed: 'desc' },
      }),
      this.prisma.game.findMany({
        where: { sessionId: id, status: 'FINISHED' },
        include: {
          court: true, // 해제(soft-delete)된 코트여도 FK가 살아 있어 번호 표시 가능
          players: { include: { attendance: { include: { member: true } } } },
        },
        orderBy: { startedAt: 'asc' },
      }),
    ]);

    return {
      session: {
        id: session.id,
        date: toDateString(session.date),
        part: (await this.dayParts([session])).get(session.id) ?? null,
        attendeeCount: session._count.attendances,
        finishedGameCount: session._count.games,
      },
      // 퇴장(LEFT)했던 사람도 그날 왔던 사람이므로 포함
      attendees: attendances.map((attendance) => ({
        memberId: attendance.memberId,
        name: attendance.member.name,
        grade: attendance.member.grade,
        gender: attendance.member.gender,
        isGuest: attendance.member.isGuest,
        gamesPlayed: attendance.gamesPlayed,
      })),
      games: games.map((game) => ({
        id: game.id,
        courtNo: game.court?.courtNo ?? null,
        startedAt: game.startedAt?.toISOString() ?? null,
        endedAt: game.endedAt?.toISOString() ?? null,
        players: game.players.map((player) => ({
          name: player.attendance.member.name,
          grade: player.attendance.member.grade,
        })),
      })),
    };
  }

  // 참여 랭킹 — 전체 모임원의 출석·게임 수 순위 (멤버 색인 겸용이라 0회도 포함해 맨 아래로)
  // months 지정 시 최근 N개월 출석만 집계 (전체 vs 요즘 활발한 사람 구분용)
  async getRanking(months?: number): Promise<IHistoryRankingEntry[]> {
    let since: Date | undefined;
    if (months) {
      since = new Date();
      since.setMonth(since.getMonth() - months);
    }

    const [members, byMember] = await Promise.all([
      // 삭제(익명화 포함) 회원 제외 — 명단 삭제 기능이 생기며 표면화된 기존 버그 수정.
      // 지난 모임 상세의 게임 기록에는 계속 남는다(기록 보존, attendance 경유라 이 필터와 무관)
      this.prisma.member.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      memberAttendanceStats(this.prisma, { since }),
    ]);

    return members
      .map((member) => {
        const agg = byMember.get(member.id);
        return {
          memberId: member.id,
          name: member.name,
          grade: member.grade,
          gender: member.gender,
          isGuest: member.isGuest,
          totalSessions: agg?.totalSessions ?? 0,
          totalGames: agg?.totalGames ?? 0,
          lastAttendedDate: agg?.lastDate ? toDateString(agg.lastDate) : null,
        };
      })
      .sort(
        (a, b) =>
          b.totalSessions - a.totalSessions ||
          b.totalGames - a.totalGames ||
          a.name.localeCompare(b.name, 'ko'), // 동률은 이름순으로 안정 정렬
      );
  }

  // 개인 전적 — 누적 출석/게임 + 함께 뛴 파트너 top 5 + 최근 모임별 게임 수
  async getMemberStats(memberId: string): Promise<IHistoryMemberStats> {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) {
      throw new NotFoundException('모임원을 찾을 수 없습니다.');
    }

    // 출석 이력 (세션 날짜 포함, 최신순) — 총 출석·총 게임·최근 출석일·최근 모임 목록의 원천
    const attendances = await this.prisma.attendance.findMany({
      where: { memberId },
      include: { session: true },
      orderBy: [{ session: { date: 'desc' } }, { session: { openedAt: 'desc' } }],
    });

    // 이 사람이 뛴 완료 게임들 → 같은 게임의 다른 참가자를 세면 파트너 통계
    const myGamePlayers = await this.prisma.gamePlayer.findMany({
      where: {
        attendance: { memberId },
        game: { status: 'FINISHED' },
      },
      select: { gameId: true },
    });
    const gameIds = myGamePlayers.map((row) => row.gameId);
    const coPlayers = gameIds.length
      ? await this.prisma.gamePlayer.findMany({
          where: {
            gameId: { in: gameIds },
            attendance: { memberId: { not: memberId } },
          },
          include: { attendance: { include: { member: true } } },
        })
      : [];

    const partnerCounts = new Map<string, { name: string; count: number }>();
    for (const row of coPlayers) {
      const other = row.attendance.member;
      const entry = partnerCounts.get(other.id) ?? { name: other.name, count: 0 };
      entry.count += 1;
      partnerCounts.set(other.id, entry);
    }

    const recentParts = await this.dayParts(attendances.slice(0, 10).map((attendance) => attendance.session));
    return {
      memberId: member.id,
      name: member.name,
      grade: member.grade,
      gender: member.gender,
      isGuest: member.isGuest,
      totalSessions: attendances.length,
      totalGames: attendances.reduce((sum, a) => sum + a.gamesPlayed, 0),
      lastAttendedDate: attendances[0] ? toDateString(attendances[0].session.date) : null,
      topPartners: [...partnerCounts.entries()]
        .map(([id, { name, count }]) => ({ memberId: id, name, gamesTogether: count }))
        .sort((x, y) => y.gamesTogether - x.gamesTogether)
        .slice(0, 5),
      recentSessions: attendances.slice(0, 10).map((attendance) => ({
        sessionId: attendance.sessionId,
        date: toDateString(attendance.session.date),
        part: recentParts.get(attendance.sessionId) ?? null,
        gamesPlayed: attendance.gamesPlayed,
      })),
    };
  }

  // 개인 출석 이력 한 쪽 — 최신순. 진행 중인 오늘 모임도 출석했으면 포함
  async getMemberSessions(memberId: string, page: number, limit: number): Promise<IHistoryMemberSessionPage> {
    const member = await this.prisma.member.findUnique({ where: { id: memberId }, select: { id: true } });
    if (!member) {
      throw new NotFoundException('모임원을 찾을 수 없습니다.');
    }

    const [attendances, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { memberId },
        orderBy: [{ session: { date: 'desc' } }, { session: { openedAt: 'desc' } }, { id: 'desc' }], // 같은 날짜 두 모임도 2부가 위로, 쪽 경계에서 겹치거나 빠지지 않게
        skip: (page - 1) * limit,
        take: limit,
        select: { sessionId: true, gamesPlayed: true, session: { select: { id: true, date: true } } },
      }),
      this.prisma.attendance.count({ where: { memberId } }),
    ]);

    const parts = await this.dayParts(attendances.map((attendance) => attendance.session));
    return {
      items: attendances.map((attendance) => ({
        sessionId: attendance.sessionId,
        date: toDateString(attendance.session.date),
        part: parts.get(attendance.sessionId) ?? null,
        gamesPlayed: attendance.gamesPlayed,
      })),
      total,
      page,
      limit,
    };
  }

  // 같은 날 모임이 둘 이상인 날짜만 시작 순서(1부·2부)를 매긴다 — 진행 중 모임도 순서에 넣는다(그날 몇 번째였는지)
  private async dayParts(sessions: { id: string; date: Date }[]): Promise<Map<string, number>> {
    if (sessions.length === 0) return new Map();
    const dates = [...new Set(sessions.map((session) => session.date.getTime()))].map((time) => new Date(time));
    const sameDays = await this.prisma.session.findMany({
      where: { date: { in: dates } },
      select: { id: true, date: true },
      orderBy: [{ date: 'asc' }, { openedAt: 'asc' }],
    });
    const byDate = new Map<number, string[]>();
    for (const session of sameDays) {
      const ids = byDate.get(session.date.getTime()) ?? [];
      ids.push(session.id);
      byDate.set(session.date.getTime(), ids);
    }
    const parts = new Map<string, number>();
    for (const ids of byDate.values()) {
      if (ids.length > 1) ids.forEach((id, index) => parts.set(id, index + 1));
    }
    return parts;
  }

  // 그날 이 사람이 뛴 완료 게임 — 자리 0·1이 한 팀, 2·3이 상대
  async getMemberSessionGames(memberId: string, sessionId: string): Promise<IHistoryMemberGame[]> {
    const attendance = await this.prisma.attendance.findFirst({
      where: { memberId, sessionId },
      select: { id: true },
    });
    if (!attendance) {
      throw new NotFoundException('그날 출석 기록을 찾을 수 없습니다.');
    }

    const games = await this.prisma.game.findMany({
      where: { sessionId, status: 'FINISHED', players: { some: { attendanceId: attendance.id } } },
      include: {
        court: true, // 해제(soft-delete)된 코트여도 번호 표시
        // 자리 도입 전 데이터는 들어온 순서로 자리를 본다(withSlots) — id(cuid)가 생성 순
        players: { include: { attendance: { include: { member: true } } }, orderBy: { id: 'asc' } },
      },
      orderBy: { startedAt: 'asc' },
    });

    return games.map((game) => {
      const toPlayer = (p: (typeof game.players)[number]) => ({
        name: p.attendance.member.name,
        grade: p.attendance.member.grade,
      });
      const others = game.players.filter((p) => p.attendanceId !== attendance.id);
      const base = {
        id: game.id,
        courtNo: game.court?.courtNo ?? null,
        startedAt: game.startedAt?.toISOString() ?? null,
        endedAt: game.endedAt?.toISOString() ?? null,
      };
      // 팀이 정해진 적 없는 옛 게임 — 들어온 순서로 나누면 틀린 팀을 보여 줄 수 있어 함께 뛴 사람만
      if (game.players.some((p) => p.slot === null)) {
        return { ...base, teamsKnown: false, partners: others.map(toPlayer), opponents: [] };
      }
      const slotted = withSlots(game.players);
      const mySlot = slotted.find((p) => p.attendanceId === attendance.id)!.slot;
      const sameTeam = (slot: number) => (slot < 2) === (mySlot < 2);
      return {
        ...base,
        teamsKnown: true,
        partners: slotted.filter((p) => p.attendanceId !== attendance.id && sameTeam(p.slot)).map(toPlayer),
        opponents: slotted.filter((p) => !sameTeam(p.slot)).map(toPlayer),
      };
    });
  }
}
