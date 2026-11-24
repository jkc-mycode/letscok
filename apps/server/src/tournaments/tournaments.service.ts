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
  ITournament,
  ITournamentDetail,
  TournamentTeam,
} from '@letscok/shared-types';
import { generateCheckInCode } from '../common/utils/code.util';
import { toDateString } from '../common/utils/date.util';
import { normalizeName } from '../common/utils/name.util';
import { Prisma, Tournament } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: ICreateTournamentDto): Promise<ITournament> {
    const active = await this.prisma.tournament.findFirst({ where: { status: { in: [...ACTIVE] } } });
    if (active) {
      throw new ConflictException('이미 준비 중이거나 진행 중인 대회가 있습니다.');
    }
    const tournament = await this.prisma.tournament.create({
      data: { name: dto.name.trim(), date: new Date(dto.date), entryCode: generateCheckInCode() },
    });
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
