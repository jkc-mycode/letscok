import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IHistoryMemberStats,
  IHistorySessionDetail,
  IHistorySessionListResponse,
} from '@letscok/shared-types';
import { toDateString } from '../common/utils/date.util';
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
        orderBy: { date: 'desc' },
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

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        date: toDateString(session.date),
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
        playerNames: game.players.map((player) => player.attendance.member.name),
      })),
    };
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
      orderBy: { session: { date: 'desc' } },
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
        date: toDateString(attendance.session.date),
        gamesPlayed: attendance.gamesPlayed,
      })),
    };
  }
}
