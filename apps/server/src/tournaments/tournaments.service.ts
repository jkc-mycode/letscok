import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BracketIssueCode,
  BracketIssueLevel,
  IBracketIssue,
  IBracketNamePick,
  IBracketPreview,
  IAddTournamentParticipantDto,
  IAddTournamentPrizesDto,
  IBracketRow,
  ICreateTournamentDto,
  IImportBracketDto,
  IReplaceTournamentPlayerDto,
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
// 끝났지만 최종 결과를 아직 내리지 않은 대회
const SHOWING_RESULT = { status: 'CLOSED', resultHiddenAt: null } as const;
const byName = (a: string, b: string) => a.localeCompare(b, 'ko');

const detailInclude = {
  participants: { include: { member: true } },
  prizes: { orderBy: { sortOrder: 'asc' }, include: { participant: { include: { member: true } } } },
  matches: {
    orderBy: { matchNo: 'asc' },
    include: {
      players: { orderBy: { slot: 'asc' }, include: { participant: { include: { member: true } }, proxyMember: true } },
    },
  },
} satisfies Prisma.TournamentInclude;
type TournamentWithDetail = Prisma.TournamentGetPayload<{ include: typeof detailInclude }>;

function assertActive(tournament: Tournament | null): Tournament {
  if (!tournament) {
    throw new NotFoundException('대회를 찾을 수 없습니다.');
  }
  if (tournament.status === 'CLOSED') {
    throw new ConflictException('이미 끝난 대회입니다.');
  }
  return tournament;
}

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
    // 지난 대회의 최종 결과가 아직 떠 있으면 내린다 — 새 대회와 겹쳐 보이지 않게
    await this.prisma.tournament.updateMany({ where: SHOWING_RESULT, data: { resultHiddenAt: new Date() } });
    const tournament = await this.prisma.tournament.create({
      data: { name: dto.name.trim(), date: new Date(dto.date), entryCode: generateCheckInCode() },
    });
    this.realtime.notifyTournamentChanged();
    return toTournament(tournament);
  }

  // 이름과 날짜 고치기 — 경기 기록과 무관해서 진행 중에도 받는다
  async update(id: string, dto: ICreateTournamentDto): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      await tx.tournament.update({ where: { id }, data: { name: dto.name.trim(), date: new Date(dto.date) } });
    });
  }

  // 잘못 만든 대회 지우기 — 시작하면 점수와 추첨 기록이 쌓이므로 준비 중일 때만. 대진표와 체크인 기록도 함께 지워진다
  async remove(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${id} FOR UPDATE`;
      const tournament = await tx.tournament.findUnique({ where: { id } });
      if (!tournament) {
        throw new NotFoundException('대회를 찾을 수 없습니다.');
      }
      if (tournament.status !== 'DRAFT') {
        throw new ConflictException('시작한 대회는 지울 수 없어요. 종료한 뒤 결과를 내려 주세요.');
      }
      await tx.tournament.delete({ where: { id } });
    });
    this.realtime.notifyTournamentChanged();
  }

  // 준비 중이거나 진행 중인 대회, 없으면 최종 결과를 아직 내리지 않은 끝난 대회 — 그것도 없으면 null
  async current(): Promise<ITournamentDetail | null> {
    const tournament =
      (await this.prisma.tournament.findFirst({ where: { status: { in: [...ACTIVE] } }, include: detailInclude })) ??
      (await this.findShowingResult());
    return tournament ? toDetail(tournament) : null;
  }

  // 모임원 화면과 전광판이 로그인 없이 읽는 대회 현황 — 진행 중이거나 최종 결과를 띄워 둔 동안만 내보내고, 입구 체크인 여부와 추첨 기록은 뺀다
  async live(): Promise<ITournamentDetail | null> {
    const tournament =
      (await this.prisma.tournament.findFirst({ where: { status: 'OPEN' }, include: detailInclude })) ??
      (await this.findShowingResult());
    if (!tournament) return null;
    const detail = toDetail(tournament);
    return {
      ...detail,
      participants: detail.participants.map((participant) => ({ ...participant, enteredAt: null, raffleNo: null })),
      prizes: [],
    };
  }

  async previewBracket(id: string, dto: IImportBracketDto): Promise<IBracketPreview> {
    await this.findActive(id);
    return (await this.resolveBracket(dto)).preview;
  }

  // 대진표 등록 — 기존 대진표를 지우고 새로 넣는다. 경기가 시작된 뒤에는 막는다
  // 참가자는 회원 기준으로 맞춘다: 이미 있는 사람은 팀만 고쳐 입구 체크인 기록을 지키고, 새 대진표에 없는 사람은 체크인하지 않았을 때만 뺀다
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

    return this.mutate(id, 'ACTIVE', async (tx) => {
      const started = await tx.tournamentMatch.count({ where: { tournamentId: id, status: { not: 'QUEUED' } } });
      if (started > 0) {
        throw new ConflictException('이미 시작한 경기가 있어 대진표를 다시 넣을 수 없습니다.');
      }
      await tx.tournamentMatch.deleteMany({ where: { tournamentId: id } });
      await tx.tournamentParticipant.deleteMany({
        where: { tournamentId: id, enteredAt: null, memberId: { notIn: [...teamOf.keys()] } },
      });
      const kept = await tx.tournamentParticipant.findMany({ where: { tournamentId: id } });
      const keptMemberIds = new Set(kept.map((p) => p.memberId));
      for (const team of [TournamentTeam.BLUE, TournamentTeam.WHITE]) {
        const moved = kept.filter((p) => p.team !== team && teamOf.get(p.memberId) === team).map((p) => p.id);
        if (moved.length > 0) {
          await tx.tournamentParticipant.updateMany({ where: { id: { in: moved } }, data: { team } });
        }
      }
      const created = await tx.tournamentParticipant.createManyAndReturn({
        data: [...teamOf]
          .filter(([member]) => !keptMemberIds.has(member))
          .map(([member, team]) => ({ tournamentId: id, memberId: member, team })),
      });
      const participantIdOf = new Map([...kept, ...created].map((p) => [p.memberId, p.id]));
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
  }

  // 참가자 추가 — 대진표에 없는 회원을 당일에 대타로 넣을 수 있게 한다. 경기에는 선수 바꾸기로 넣는다
  async addParticipant(id: string, dto: IAddTournamentParticipantDto): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      const member = await tx.member.findFirst({ where: { id: dto.memberId, deletedAt: null } });
      if (!member) {
        throw new NotFoundException('회원을 찾을 수 없습니다.');
      }
      const existing = await tx.tournamentParticipant.findFirst({ where: { tournamentId: id, memberId: dto.memberId } });
      if (existing) {
        throw new ConflictException(`이미 ${existing.team === TournamentTeam.BLUE ? '청팀' : '백팀'} 참가자입니다.`);
      }
      await tx.tournamentParticipant.create({ data: { tournamentId: id, memberId: dto.memberId, team: dto.team } });
    });
  }

  // 참가자 빼기 — 잘못 추가했을 때. 경기에 들어가 있는 사람은 뺄 수 없다(먼저 선수 바꾸기로 뺀다)
  async removeParticipant(id: string, participantId: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      const participant = await tx.tournamentParticipant.findFirst({
        where: { id: participantId, tournamentId: id },
        include: { _count: { select: { matchPlayers: true } } },
      });
      if (!participant) {
        throw new NotFoundException('참가자를 찾을 수 없습니다.');
      }
      if (participant._count.matchPlayers > 0) {
        throw new ConflictException('경기에 들어가 있는 사람은 뺄 수 없습니다.');
      }
      await tx.tournamentParticipant.delete({ where: { id: participantId } });
    });
  }

  // 입구 체크인 — 대회를 시작하기 전(준비 중)에도 받는다. 처음 누른 시각을 남기고, 되돌리면 지운다
  async setEntry(id: string, participantId: string, entered: boolean): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      const participant = await tx.tournamentParticipant.findFirst({ where: { id: participantId, tournamentId: id } });
      if (!participant) {
        throw new NotFoundException('참가자를 찾을 수 없습니다.');
      }
      if (entered === (participant.enteredAt !== null)) return;
      // 추첨 번호는 체크인 순서 — 지금까지 나간 가장 큰 번호의 다음. 되돌리면 번호를 비운다
      const last = await tx.tournamentParticipant.aggregate({ where: { tournamentId: id }, _max: { raffleNo: true } });
      await tx.tournamentParticipant.update({
        where: { id: participantId },
        data: entered ? { enteredAt: new Date(), raffleNo: (last._max.raffleNo ?? 0) + 1 } : { enteredAt: null, raffleNo: null },
      });
    });
  }

  // 추첨 번호 고치기 — 추첨권을 서로 바꿨거나 순서가 꼬였을 때. 그 번호를 가진 사람이 있으면 두 사람의 번호를 맞바꾼다
  async setRaffleNo(id: string, participantId: string, raffleNo: number): Promise<ITournamentDetail> {
    return this.mutate(id, 'SHOWN', async (tx) => {
      const participant = await tx.tournamentParticipant.findFirst({ where: { id: participantId, tournamentId: id } });
      if (!participant) {
        throw new NotFoundException('참가자를 찾을 수 없습니다.');
      }
      if (participant.enteredAt === null) {
        throw new ConflictException('체크인한 사람만 추첨 번호를 가질 수 있습니다.');
      }
      if (participant.raffleNo === raffleNo) return;
      const holder = await tx.tournamentParticipant.findFirst({ where: { tournamentId: id, raffleNo } });
      if (holder) {
        await tx.tournamentParticipant.update({ where: { id: holder.id }, data: { raffleNo: null } });
      }
      await tx.tournamentParticipant.update({ where: { id: participantId }, data: { raffleNo } });
      if (holder) {
        await tx.tournamentParticipant.update({ where: { id: holder.id }, data: { raffleNo: participant.raffleNo } });
      }
    });
  }

  // 추첨 상품 등록 — 대회 전에 미리 넣어 둔다. 이름 하나가 상품 하나
  async addPrizes(id: string, dto: IAddTournamentPrizesDto): Promise<ITournamentDetail> {
    const names = dto.names.map((name) => name.trim()).filter((name) => name.length > 0);
    if (names.length === 0) {
      throw new BadRequestException('등록할 상품 이름을 적어 주세요.');
    }
    return this.mutate(id, 'SHOWN', async (tx) => {
      const last = await tx.tournamentPrize.aggregate({ where: { tournamentId: id }, _max: { sortOrder: true } });
      const from = (last._max.sortOrder ?? 0) + 1;
      await tx.tournamentPrize.createMany({ data: names.map((name, index) => ({ tournamentId: id, name, sortOrder: from + index })) });
    });
  }

  // 당첨 기록이 있는 상품은 기록을 먼저 지워야 뺄 수 있다 — 잘못 눌러 당첨 기록이 사라지지 않게
  async removePrize(id: string, prizeId: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'SHOWN', async (tx) => {
      const prize = await this.findPrize(tx, id, prizeId);
      if (prize.participantId !== null) {
        throw new ConflictException('당첨 기록이 있는 상품입니다. 당첨 기록을 먼저 지워 주세요.');
      }
      await tx.tournamentPrize.delete({ where: { id: prizeId } });
    });
  }

  // 당첨 기록 — 뽑힌 추첨 번호를 적으면 그 번호의 참가자가 당첨자로 남는다. 다시 적으면 덮어쓴다
  async setPrizeWinner(id: string, prizeId: string, raffleNo: number): Promise<ITournamentDetail> {
    return this.mutate(id, 'SHOWN', async (tx) => {
      await this.findPrize(tx, id, prizeId);
      const winner = await tx.tournamentParticipant.findFirst({ where: { tournamentId: id, raffleNo } });
      if (!winner) {
        throw new NotFoundException(`${raffleNo}번 추첨권을 받은 사람이 없습니다.`);
      }
      await tx.tournamentPrize.update({ where: { id: prizeId }, data: { raffleNo, participantId: winner.id, drawnAt: new Date() } });
    });
  }

  async clearPrizeWinner(id: string, prizeId: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'SHOWN', async (tx) => {
      await this.findPrize(tx, id, prizeId);
      await tx.tournamentPrize.update({ where: { id: prizeId }, data: { raffleNo: null, participantId: null, drawnAt: null } });
    });
  }

  private async findPrize(tx: Prisma.TransactionClient, id: string, prizeId: string) {
    const prize = await tx.tournamentPrize.findFirst({ where: { id: prizeId, tournamentId: id } });
    if (!prize) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    return prize;
  }

  // 대회 시작 — 이때부터 모임원 링크가 대회 현황으로 바뀐다
  async open(id: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx, tournament) => {
      if (tournament.status === 'OPEN') {
        throw new ConflictException('이미 진행 중인 대회입니다.');
      }
      const matches = await tx.tournamentMatch.count({ where: { tournamentId: id } });
      if (matches === 0) {
        throw new BadRequestException('대진표를 먼저 넣어 주세요.');
      }
      await tx.tournament.update({ where: { id }, data: { status: 'OPEN', openedAt: new Date() } });
    });
  }

  // 대회 종료 — 치르지 않은 대기 경기는 남겨 둔 채 끝낼 수 있다. 진행 중인 경기는 먼저 정리해야 한다
  // 끝난 대회는 운영진이 결과를 내릴 때까지 최종 결과로 계속 보인다
  async close(id: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'OPEN', async (tx) => {
      const playing = await tx.tournamentMatch.count({ where: { tournamentId: id, status: 'PLAYING' } });
      if (playing > 0) {
        throw new ConflictException('진행 중인 경기가 있어요. 점수를 넣거나 대기로 돌린 뒤 종료해 주세요.');
      }
      await tx.tournament.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    });
  }

  // 최종 결과 내리기 — 모임원 화면과 전광판이 평소 화면으로 돌아간다. 기록은 그대로 남는다
  async hideResult(id: string): Promise<void> {
    const hidden = await this.prisma.tournament.updateMany({
      where: { id, ...SHOWING_RESULT },
      data: { resultHiddenAt: new Date() },
    });
    if (hidden.count === 0) {
      throw new ConflictException('결과를 띄워 둔 대회가 아닙니다.');
    }
    this.realtime.notifyTournamentChanged();
  }

  // 경기를 코트에 올린다 — 코트가 비어 있어야 하고, 선수가 다른 코트에서 경기 중이면 force 없이는 막는다(경고)
  async startMatch(id: string, matchId: string, dto: IStartTournamentMatchDto): Promise<ITournamentDetail> {
    return this.mutate(id, 'OPEN', async (tx, tournament) => {
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
  }

  // 잘못 올린 경기를 대기로 되돌린다
  async cancelStart(id: string, matchId: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'OPEN', async (tx) => {
      const { count } = await tx.tournamentMatch.updateMany({
        where: { id: matchId, tournamentId: id, status: 'PLAYING' },
        data: { status: 'QUEUED', startedAt: null },
      });
      if (count === 0) {
        throw new ConflictException('진행 중인 경기만 대기로 돌릴 수 있습니다.');
      }
    });
  }

  // 대기 경기 순서 바꾸기 — 대기 경기 전부를 새 순서대로 받아 1부터 다시 매긴다
  async reorderQueue(id: string, matchIds: string[]): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      const queued = await tx.tournamentMatch.findMany({ where: { tournamentId: id, status: 'QUEUED' }, select: { id: true } });
      const sent = new Set(matchIds);
      if (sent.size !== matchIds.length || sent.size !== queued.length || queued.some((match) => !sent.has(match.id))) {
        throw new ConflictException('대기 경기가 바뀌었어요. 화면을 다시 확인한 뒤 순서를 바꿔 주세요.');
      }
      for (const [index, matchId] of matchIds.entries()) {
        await tx.tournamentMatch.update({ where: { id: matchId }, data: { queueOrder: index + 1 } });
      }
    });
  }

  // 선수 바꾸기 — 불참·부상이면 같은 팀의 다른 참가자로, swapMatchId가 있으면 그 경기의 사람과 맞바꾼다
  // 끝난 경기는 바꾸지 않는다(기록이 달라진다). 대리 표시가 있던 자리는 새 선수가 들어오면 지운다
  async replacePlayer(id: string, matchId: string, slot: number, dto: IReplaceTournamentPlayerDto): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      const matches = await tx.tournamentMatch.findMany({
        where: { tournamentId: id },
        include: { players: { include: { participant: { include: { member: true } } } } },
      });
      const match = matches.find((m) => m.id === matchId);
      const current = match?.players.find((player) => player.slot === slot);
      if (!match || !current) {
        throw new NotFoundException('경기나 자리를 찾을 수 없습니다.');
      }
      if (match.status === 'FINISHED') {
        throw new ConflictException('끝난 경기의 선수는 바꿀 수 없습니다.');
      }
      const incoming = await tx.tournamentParticipant.findFirst({
        where: { id: dto.participantId, tournamentId: id },
        include: { member: true },
      });
      if (!incoming) {
        throw new NotFoundException('참가자를 찾을 수 없습니다.');
      }
      if (incoming.team !== current.participant.team) {
        throw new BadRequestException('같은 팀의 사람으로만 바꿀 수 있습니다.');
      }
      if (match.players.some((player) => player.participantId === incoming.id)) {
        throw new BadRequestException('이미 이 경기에 있는 사람입니다.');
      }

      const other = dto.swapMatchId ? matches.find((m) => m.id === dto.swapMatchId) : undefined;
      const otherSlot = other?.players.find((player) => player.participantId === incoming.id);
      if (dto.swapMatchId) {
        if (!other || !otherSlot || other.id === match.id) {
          throw new BadRequestException('맞바꿀 경기에 그 사람이 없습니다.');
        }
        if (other.status === 'FINISHED') {
          throw new ConflictException('끝난 경기의 선수와는 맞바꿀 수 없습니다.');
        }
        if (other.players.some((player) => player.participantId === current.participantId)) {
          throw new BadRequestException('맞바꾸면 한 경기에 같은 사람이 두 번 들어갑니다.');
        }
      }

      if (!dto.force) {
        // 바꾼 뒤의 모습에서 겹침을 찾는다 — into에 들어가는 사람이 그 경기 말고 어디에 또 있는지
        const conflicts = (participantId: string, name: string, into: typeof match, leaving?: typeof match): string[] =>
          matches
            .filter((m) => m.id !== into.id && m.id !== leaving?.id && m.players.some((p) => p.participantId === participantId))
            .flatMap((m) => [
              ...(m.round === into.round ? [`${name} 님이 ${into.round}라운드에 이미 있어요(${m.matchNo}번)`] : []),
              ...(m.status === 'PLAYING' && into.status === 'PLAYING' ? [`${name} 님이 ${m.courtNo}코트에서 경기 중이에요`] : []),
            ]);
        const found = [
          ...conflicts(incoming.id, incoming.member.name, match, other),
          ...(other ? conflicts(current.participantId, current.participant.member.name, other, match) : []),
        ];
        if (found.length > 0) {
          throw new ConflictException({ statusCode: 409, message: `${found.join(', ')}.`, error: TOURNAMENT_PLAYER_BUSY });
        }
      }

      await tx.tournamentMatchPlayer.update({ where: { id: current.id }, data: { participantId: incoming.id, proxyMemberId: null } });
      if (otherSlot) {
        await tx.tournamentMatchPlayer.update({
          where: { id: otherSlot.id },
          data: { participantId: current.participantId, proxyMemberId: null },
        });
      }
    });
  }

  // 지각 대리 경기 — 대진표의 선수는 그대로 두고 대신 뛴 회원만 적는다. memberId가 null이면 대리 표시를 지운다
  // 한 팀에만 대리가 있으면 집계에서 그 팀의 0:21 패배로 본다. 표시를 빠뜨린 채 점수를 넣었을 수 있어 끝난 경기에도 고칠 수 있다
  async setProxy(id: string, matchId: string, slot: number, memberId: string | null): Promise<ITournamentDetail> {
    return this.mutate(id, 'ACTIVE', async (tx) => {
      const match = await tx.tournamentMatch.findFirst({
        where: { id: matchId, tournamentId: id },
        include: { players: { include: { participant: true } } },
      });
      const current = match?.players.find((player) => player.slot === slot);
      if (!match || !current) {
        throw new NotFoundException('경기나 자리를 찾을 수 없습니다.');
      }
      if (memberId) {
        const member = await tx.member.findFirst({ where: { id: memberId, deletedAt: null, isGuest: false } });
        if (!member) {
          throw new NotFoundException('회원을 찾을 수 없습니다.');
        }
        const inMatch = match.players.some(
          (player) => player.participant.memberId === memberId || (player.slot !== slot && player.proxyMemberId === memberId),
        );
        if (inMatch) {
          throw new BadRequestException('이미 이 경기에 있는 사람입니다.');
        }
      }
      await tx.tournamentMatchPlayer.update({ where: { id: current.id }, data: { proxyMemberId: memberId } });
    });
  }

  // 점수 입력과 수정 — 승리 팀은 저장하지 않고 점수에서 읽는다. 코트에 올리지 않고 치른 대기 경기에도 바로 넣을 수 있다
  async setScore(id: string, matchId: string, dto: ISetTournamentScoreDto): Promise<ITournamentDetail> {
    return this.mutate(id, 'OPEN', async (tx) => {
      const { blueScore, whiteScore } = dto;
      const winnerCount = [blueScore, whiteScore].filter((score) => score === TOURNAMENT_WIN_SCORE).length;
      if (winnerCount !== 1) {
        throw new BadRequestException(
          `${TOURNAMENT_WIN_SCORE}점 단판이에요. 이긴 팀은 ${TOURNAMENT_WIN_SCORE}점, 진 팀은 0~${TOURNAMENT_WIN_SCORE - 1}점이어야 해요.`,
        );
      }
      const match = await tx.tournamentMatch.findFirst({ where: { id: matchId, tournamentId: id } });
      if (!match) {
        throw new NotFoundException('경기를 찾을 수 없습니다.');
      }
      await tx.tournamentMatch.update({
        where: { id: matchId },
        // 고칠 때는 처음 끝난 시각을 그대로 둔다
        data: { status: 'FINISHED', blueScore, whiteScore, endedAt: match.endedAt ?? new Date() },
      });
    });
  }

  // 점수 지우기 — 잘못된 경기에 넣었을 때. 그 경기는 대기로 돌아가고, 다시 치르려면 빈 코트에 올린다
  async clearScore(id: string, matchId: string): Promise<ITournamentDetail> {
    return this.mutate(id, 'OPEN', async (tx) => {
      const { count } = await tx.tournamentMatch.updateMany({
        where: { id: matchId, tournamentId: id, status: 'FINISHED' },
        data: { status: 'QUEUED', blueScore: null, whiteScore: null, startedAt: null, endedAt: null },
      });
      if (count === 0) {
        throw new ConflictException('점수가 들어간 경기만 지울 수 있습니다.');
      }
    });
  }

  // 대회를 바꾸는 요청은 대회 줄을 잠그고 하나씩 처리한다 — 운영진 둘이 동시에 눌러도 서로 옛 상태를 보고 검사를 통과하지 않게
  // need가 OPEN이면 진행 중인 대회만, ACTIVE면 준비 중인 대회도 받는다
  // need 'SHOWN': 끝났어도 최종 결과를 띄워 둔 동안은 허용 — 추첨은 경기를 다 마친 뒤에 하기도 한다
  private async mutate(
    id: string,
    need: 'ACTIVE' | 'OPEN' | 'SHOWN',
    work: (tx: Prisma.TransactionClient, tournament: Tournament) => Promise<void>,
  ): Promise<ITournamentDetail> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${id} FOR UPDATE`;
      const found = await tx.tournament.findUnique({ where: { id } });
      const tournament = need === 'SHOWN' && found?.status === 'CLOSED' && found.resultHiddenAt === null ? found : assertActive(found);
      if (need === 'OPEN' && tournament.status !== 'OPEN') {
        throw new ConflictException('대회를 먼저 시작해 주세요.');
      }
      await work(tx, tournament);
    });
    return this.changed();
  }

  // 바뀐 뒤의 대회를 돌려주고, 다른 화면에 다시 읽으라는 신호를 보낸다
  private async changed(): Promise<ITournamentDetail> {
    this.realtime.notifyTournamentChanged();
    return (await this.current())!;
  }

  private findShowingResult(): Promise<TournamentWithDetail | null> {
    return this.prisma.tournament.findFirst({ where: SHOWING_RESULT, orderBy: { closedAt: 'desc' }, include: detailInclude });
  }

  private async findActive(id: string): Promise<Tournament> {
    return assertActive(await this.prisma.tournament.findUnique({ where: { id } }));
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
        raffleNo: participant.raffleNo,
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
    prizes: tournament.prizes.map((prize) => ({
      id: prize.id,
      name: prize.name,
      raffleNo: prize.raffleNo,
      participantId: prize.participantId,
      winnerName: prize.participant?.member.name ?? null,
      drawnAt: prize.drawnAt?.toISOString() ?? null,
    })),
  };
}
