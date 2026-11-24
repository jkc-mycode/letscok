import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BracketIssueCode,
  BracketIssueLevel,
  IBracketIssue,
  IBracketNamePick,
  IBracketPreview,
  IBracketRow,
  ICreateTournamentDto,
  IImportBracketDto,
  ISetTournamentScoreDto,
  IStartTournamentMatchDto,
  ITournament,
  ITournamentDetail,
  TOURNAMENT_PLAYER_BUSY,
  TOURNAMENT_WIN_SCORE,
  TournamentTeam,
} from '@letscok/shared-types';
import { generateCheckInCode } from '../common/utils/code.util';
import { toDateString } from '../common/utils/date.util';
import { normalizeName } from '../common/utils/name.util';
import { Prisma, Tournament } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { checkBracketPeople, parseBracket } from './bracket-parser';

const ACTIVE = ['DRAFT', 'OPEN'] as const;
const byName = (a: string, b: string) => a.localeCompare(b, 'ko');

const detailInclude = {
  participants: { include: { member: true } },
  matches: {
    orderBy: { matchNo: 'asc' },
    include: {
      players: { orderBy: { slot: 'asc' }, include: { participant: { include: { member: true } }, proxyMember: true } },
    },
  },
} satisfies Prisma.TournamentInclude;
type TournamentWithDetail = Prisma.TournamentGetPayload<{ include: typeof detailInclude }>;

interface ResolvedBracket {
  preview: IBracketPreview;
  memberIdOf: Map<string, string>; // 정규화한 이름 → 회원 id (찾은 이름만)
}

// 자체 대회(청백전) — 평소 모임과 따로 연다. 준비 중이거나 진행 중인 대회는 늘 하나뿐
@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(dto: ICreateTournamentDto): Promise<ITournament> {
    const active = await this.prisma.tournament.findFirst({ where: { status: { in: [...ACTIVE] } } });
    if (active) {
      throw new ConflictException('이미 준비 중이거나 진행 중인 대회가 있습니다.');
    }
    const tournament = await this.prisma.tournament.create({
      data: { name: dto.name.trim(), date: new Date(dto.date), entryCode: generateCheckInCode() },
    });
    this.realtime.notifyTournamentChanged();
    return toTournament(tournament);
  }

  // 준비 중이거나 진행 중인 대회 — 없으면 null
  async current(): Promise<ITournamentDetail | null> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { status: { in: [...ACTIVE] } },
      include: detailInclude,
    });
    return tournament ? toDetail(tournament) : null;
  }

  // 모임원 화면과 전광판이 로그인 없이 읽는 대회 현황 — 진행 중일 때만 내보내고, 입구 체크인 여부는 뺀다
  async live(): Promise<ITournamentDetail | null> {
    const tournament = await this.prisma.tournament.findFirst({ where: { status: 'OPEN' }, include: detailInclude });
    if (!tournament) return null;
    const detail = toDetail(tournament);
    return { ...detail, participants: detail.participants.map((participant) => ({ ...participant, enteredAt: null })) };
  }

  async previewBracket(id: string, dto: IImportBracketDto): Promise<IBracketPreview> {
    await this.findActive(id);
    return (await this.resolveBracket(dto)).preview;
  }

  // 대진표 등록 — 기존 대진표와 참가자를 지우고 새로 넣는다. 경기가 시작된 뒤에는 막는다
  async importBracket(id: string, dto: IImportBracketDto): Promise<ITournamentDetail> {
    await this.findActive(id);
    const { preview, memberIdOf } = await this.resolveBracket(dto);
    if (!preview.canImport) {
      const first = preview.issues.find((issue) => issue.level === BracketIssueLevel.ERROR);
      throw new BadRequestException(first?.message ?? '등록할 경기가 없습니다.');
    }
    const memberId = (name: string) => memberIdOf.get(normalizeName(name))!;
    const teamOf = new Map<string, TournamentTeam>();
    for (const row of preview.rows) {
      row.blue.forEach((name) => teamOf.set(memberId(name), TournamentTeam.BLUE));
      row.white.forEach((name) => teamOf.set(memberId(name), TournamentTeam.WHITE));
    }

    await this.prisma.$transaction(async (tx) => {
      const started = await tx.tournamentMatch.count({ where: { tournamentId: id, status: { not: 'QUEUED' } } });
      if (started > 0) {
        throw new ConflictException('이미 시작한 경기가 있어 대진표를 다시 넣을 수 없습니다.');
      }
      await tx.tournamentMatch.deleteMany({ where: { tournamentId: id } });
      await tx.tournamentParticipant.deleteMany({ where: { tournamentId: id } });
      const participants = await tx.tournamentParticipant.createManyAndReturn({
        data: [...teamOf].map(([member, team]) => ({ tournamentId: id, memberId: member, team })),
      });
      const participantIdOf = new Map(participants.map((p) => [p.memberId, p.id]));
      const matches = await tx.tournamentMatch.createManyAndReturn({
        data: preview.rows.map((row) => ({
          tournamentId: id,
          matchNo: row.matchNo,
          round: row.round,
          courtNo: row.courtNo,
          type: row.type,
          queueOrder: row.matchNo,
        })),
      });
      const matchIdOf = new Map(matches.map((m) => [m.matchNo, m.id]));
      await tx.tournamentMatchPlayer.createMany({
        data: preview.rows.flatMap((row) =>
          [...row.blue, ...row.white].map((name, slot) => ({
            matchId: matchIdOf.get(row.matchNo)!,
            participantId: participantIdOf.get(memberId(name))!,
            slot,
          })),
        ),
      });
      // 코트 수는 대진표에 나온 가장 큰 코트 번호를 따른다
      await tx.tournament.update({
        where: { id },
        data: { courtCount: Math.max(...preview.rows.map((row) => row.courtNo)) },
      });
    });

    return this.changed();
  }

  // 대회 시작 — 이때부터 모임원 링크가 대회 현황으로 바뀐다
  async open(id: string): Promise<ITournamentDetail> {
    const tournament = await this.findActive(id);
    if (tournament.status === 'OPEN') {
      throw new ConflictException('이미 진행 중인 대회입니다.');
    }
    const matches = await this.prisma.tournamentMatch.count({ where: { tournamentId: id } });
    if (matches === 0) {
      throw new BadRequestException('대진표를 먼저 넣어 주세요.');
    }
    await this.prisma.tournament.update({ where: { id }, data: { status: 'OPEN', openedAt: new Date() } });
    return this.changed();
  }

  // 대회 종료 — 치르지 않은 대기 경기는 남겨 둔 채 끝낼 수 있다. 진행 중인 경기는 먼저 정리해야 한다
  async close(id: string): Promise<ITournament> {
    await this.findOpen(id);
    const playing = await this.prisma.tournamentMatch.count({ where: { tournamentId: id, status: 'PLAYING' } });
    if (playing > 0) {
      throw new ConflictException('진행 중인 경기가 있어요. 점수를 넣거나 대기로 돌린 뒤 종료해 주세요.');
    }
    const closed = await this.prisma.tournament.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    this.realtime.notifyTournamentChanged();
    return toTournament(closed);
  }

  // 경기를 코트에 올린다 — 코트가 비어 있어야 하고, 선수가 다른 코트에서 경기 중이면 force 없이는 막는다(경고)
  async startMatch(id: string, matchId: string, dto: IStartTournamentMatchDto): Promise<ITournamentDetail> {
    const tournament = await this.findOpen(id);
    await this.prisma.$transaction(async (tx) => {
      const match = await tx.tournamentMatch.findFirst({ where: { id: matchId, tournamentId: id }, include: { players: true } });
      if (!match) {
        throw new NotFoundException('경기를 찾을 수 없습니다.');
      }
      if (match.status !== 'QUEUED') {
        throw new ConflictException('대기 중인 경기만 시작할 수 있습니다.');
      }
      const courtNo = dto.courtNo ?? match.courtNo;
      if (courtNo > tournament.courtCount) {
        throw new BadRequestException(`코트는 ${tournament.courtCount}번까지 있습니다.`);
      }
      const playing = await tx.tournamentMatch.findMany({
        where: { tournamentId: id, status: 'PLAYING' },
        include: { players: { include: { participant: { include: { member: true } } } } },
      });
      if (playing.some((other) => other.courtNo === courtNo)) {
        throw new ConflictException(`${courtNo}코트에서 다른 경기가 진행 중입니다.`);
      }
      if (!dto.force) {
        const mine = new Set(match.players.map((player) => player.participantId));
        const busy = playing.flatMap((other) =>
          other.players
            .filter((player) => mine.has(player.participantId))
            .map((player) => `${player.participant.member.name} 님(${other.courtNo}코트)`),
        );
        if (busy.length > 0) {
          throw new ConflictException({
            statusCode: 409,
            message: `${busy.join(', ')}이 아직 경기 중이에요.`,
            error: TOURNAMENT_PLAYER_BUSY,
          });
        }
      }
      await tx.tournamentMatch.update({ where: { id: matchId }, data: { status: 'PLAYING', courtNo, startedAt: new Date() } });
    });
    return this.changed();
  }

  // 잘못 올린 경기를 대기로 되돌린다
  async cancelStart(id: string, matchId: string): Promise<ITournamentDetail> {
    await this.findOpen(id);
    const { count } = await this.prisma.tournamentMatch.updateMany({
      where: { id: matchId, tournamentId: id, status: 'PLAYING' },
      data: { status: 'QUEUED', startedAt: null },
    });
    if (count === 0) {
      throw new ConflictException('진행 중인 경기만 대기로 돌릴 수 있습니다.');
    }
    return this.changed();
  }

  // 점수 입력과 수정 — 승리 팀은 저장하지 않고 점수에서 읽는다. 코트에 올리지 않고 치른 대기 경기에도 바로 넣을 수 있다
  async setScore(id: string, matchId: string, dto: ISetTournamentScoreDto): Promise<ITournamentDetail> {
    await this.findOpen(id);
    const { blueScore, whiteScore } = dto;
    const winnerCount = [blueScore, whiteScore].filter((score) => score === TOURNAMENT_WIN_SCORE).length;
    if (winnerCount !== 1) {
      throw new BadRequestException(
        `${TOURNAMENT_WIN_SCORE}점 단판이에요. 이긴 팀은 ${TOURNAMENT_WIN_SCORE}점, 진 팀은 0~${TOURNAMENT_WIN_SCORE - 1}점이어야 해요.`,
      );
    }
    const match = await this.prisma.tournamentMatch.findFirst({ where: { id: matchId, tournamentId: id } });
    if (!match) {
      throw new NotFoundException('경기를 찾을 수 없습니다.');
    }
    await this.prisma.tournamentMatch.update({
      where: { id: matchId },
      // 고칠 때는 처음 끝난 시각을 그대로 둔다
      data: { status: 'FINISHED', blueScore, whiteScore, endedAt: match.endedAt ?? new Date() },
    });
    return this.changed();
  }

  // 점수 지우기 — 잘못된 경기에 넣었을 때. 그 경기는 대기로 돌아가고, 다시 치르려면 빈 코트에 올린다
  async clearScore(id: string, matchId: string): Promise<ITournamentDetail> {
    await this.findOpen(id);
    const { count } = await this.prisma.tournamentMatch.updateMany({
      where: { id: matchId, tournamentId: id, status: 'FINISHED' },
      data: { status: 'QUEUED', blueScore: null, whiteScore: null, startedAt: null, endedAt: null },
    });
    if (count === 0) {
      throw new ConflictException('점수가 들어간 경기만 지울 수 있습니다.');
    }
    return this.changed();
  }

  private async findOpen(id: string): Promise<Tournament> {
    const tournament = await this.findActive(id);
    if (tournament.status !== 'OPEN') {
      throw new ConflictException('대회를 먼저 시작해 주세요.');
    }
    return tournament;
  }

  // 바뀐 뒤의 대회를 돌려주고, 다른 화면에 다시 읽으라는 신호를 보낸다
  private async changed(): Promise<ITournamentDetail> {
    this.realtime.notifyTournamentChanged();
    return (await this.current())!;
  }

  private async findActive(id: string): Promise<Tournament> {
    const tournament = await this.prisma.tournament.findUnique({ where: { id } });
    if (!tournament) {
      throw new NotFoundException('대회를 찾을 수 없습니다.');
    }
    if (tournament.status === 'CLOSED') {
      throw new ConflictException('이미 끝난 대회입니다.');
    }
    return tournament;
  }

  // 붙여 넣은 글자를 읽고 이름을 회원과 잇는다 — 별명(소모임 표기)도 이름으로 받는다
  private async resolveBracket(dto: IImportBracketDto): Promise<ResolvedBracket> {
    const { rows, issues } = parseBracket(dto.text);
    const [members, aliases] = await Promise.all([
      this.prisma.member.findMany({ where: { deletedAt: null } }),
      this.prisma.memberAlias.findMany({ where: { member: { deletedAt: null } }, include: { member: true } }),
    ]);
    const byNormalized = new Map<string, typeof members>();
    for (const member of members) {
      const key = normalizeName(member.name);
      byNormalized.set(key, [...(byNormalized.get(key) ?? []), member]);
    }
    for (const { alias, member } of aliases) {
      if (!byNormalized.has(alias)) byNormalized.set(alias, [member]);
    }
    const pickOf = new Map((dto.picks ?? []).map((pick: IBracketNamePick) => [normalizeName(pick.name), pick.memberId]));

    const memberIdOf = new Map<string, string>();
    const matchNosOf = new Map<string, { name: string; matchNos: number[] }>();
    for (const row of rows) {
      for (const name of [...row.blue, ...row.white]) {
        const key = normalizeName(name);
        const entry = matchNosOf.get(key) ?? { name, matchNos: [] };
        entry.matchNos.push(row.matchNo);
        matchNosOf.set(key, entry);
      }
    }
    for (const [key, { name, matchNos }] of matchNosOf) {
      const found = byNormalized.get(key) ?? [];
      const picked = found.find((member) => member.id === pickOf.get(key));
      if (found.length === 1 || picked) {
        memberIdOf.set(key, (picked ?? found[0]).id);
      } else if (found.length === 0) {
        issues.push({
          level: BracketIssueLevel.ERROR,
          code: BracketIssueCode.UNKNOWN_NAME,
          message: `${name} 님이 회원 명단에 없어요. 먼저 회원으로 등록해 주세요.`,
          matchNos,
          name,
        });
      } else {
        issues.push({
          level: BracketIssueLevel.ERROR,
          code: BracketIssueCode.AMBIGUOUS_NAME,
          message: `${name} 님이 명단에 ${found.length}명 있어요. 누구인지 골라 주세요.`,
          matchNos,
          name,
          candidates: found.map((member) => ({
            memberId: member.id,
            label: `${member.name} (${member.birthDate ? `${member.birthDate.getUTCFullYear()}년생, ` : ''}${member.grade})`,
          })),
        });
      }
    }
    const keyOf = (name: string) => memberIdOf.get(normalizeName(name)) ?? normalizeName(name);
    issues.push(...checkBracketPeople(rows, keyOf));

    return {
      preview: {
        rows,
        issues,
        blueNames: teamNames(rows, 'blue'),
        whiteNames: teamNames(rows, 'white'),
        canImport: rows.length > 0 && issues.every((issue: IBracketIssue) => issue.level !== BracketIssueLevel.ERROR),
      },
      memberIdOf,
    };
  }
}

function teamNames(rows: IBracketRow[], side: 'blue' | 'white'): string[] {
  return [...new Set(rows.flatMap((row) => row[side]))].sort(byName);
}

function toTournament(tournament: Tournament): ITournament {
  return {
    id: tournament.id,
    name: tournament.name,
    date: toDateString(tournament.date),
    status: tournament.status,
    courtCount: tournament.courtCount,
    openedAt: tournament.openedAt?.toISOString() ?? null,
    closedAt: tournament.closedAt?.toISOString() ?? null,
  };
}

function toDetail(tournament: TournamentWithDetail): ITournamentDetail {
  return {
    tournament: toTournament(tournament),
    participants: tournament.participants
      .map((participant) => ({
        id: participant.id,
        memberId: participant.memberId,
        name: participant.member.name,
        gender: participant.member.gender,
        team: participant.team,
        enteredAt: participant.enteredAt?.toISOString() ?? null,
      }))
      .sort((a, b) => byName(a.name, b.name)),
    matches: tournament.matches.map((match) => ({
      id: match.id,
      matchNo: match.matchNo,
      round: match.round,
      courtNo: match.courtNo,
      type: match.type,
      status: match.status,
      queueOrder: match.queueOrder,
      blueScore: match.blueScore,
      whiteScore: match.whiteScore,
      startedAt: match.startedAt?.toISOString() ?? null,
      endedAt: match.endedAt?.toISOString() ?? null,
      players: match.players.map((player) => ({
        slot: player.slot,
        participantId: player.participantId,
        name: player.participant.member.name,
        proxyName: player.proxyMember?.name ?? null,
      })),
    })),
  };
}
