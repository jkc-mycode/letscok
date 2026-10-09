import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GAME_SIZE, IFillCourtsResult, IGame, IPushCallResult } from '@letscok/shared-types';
import { pickFreeSlot, withSlots } from '../common/utils/game-slots';
import { Prisma } from '../generated/prisma/client';
import { toGameResponse } from '../common/mappers/entity.mappers';
import { createCooldown } from '../common/utils/cooldown.util';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  AddGamePlayerDto,
  AssignGameDto,
  CreateDraftGameDto,
  CreateGameDto,
  ReorderGamesDto,
  ReplaceGamePlayerDto,
  UpdateGameOrderDto,
} from './dto/game.dtos';

// 게임 조회 시 항상 플레이어+회원까지 포함 (보드 렌더링 단위)
const GAME_INCLUDE = {
  players: { include: { attendance: { include: { member: true } } } },
} as const;

// 코트 [다시 알림] — 같은 게임을 30초 안에 다시 보내면 막는다 (운영진 호출과 같은 기준)
const renotifyCooldown = createCooldown(30_000);

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  // 조합 생성: 4명 → QUEUED 게임. 중복 대기 허용 정책 —
  // 한 사람이 여러 QUEUED 게임에 동시에 들어갈 수 있고(다음다음 게임 미리 짜기),
  // 게임 중(PLAYING)인 사람도 미리 넣을 수 있다. 퇴장(LEFT)·휴식(RESTING)만 불가
  async create(sessionId: string, dto: CreateGameDto): Promise<IGame> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const uniqueIds = [...new Set(dto.attendanceIds)];
    if (uniqueIds.length !== 4) {
      throw new BadRequestException('같은 모임원이 중복 선택되었습니다.');
    }

    const activeCount = await this.prisma.attendance.count({
      where: {
        id: { in: uniqueIds },
        sessionId,
        status: { notIn: ['LEFT', 'RESTING'] },
        shuttleConfirmedAt: { not: null }, // 콕 미확인은 게임 배정 불가
      },
    });
    if (activeCount !== 4) {
      throw new ConflictException(
        '콕 미확인·퇴장·휴식 중이거나 이 모임에 없는 모임원이 포함되어 있습니다.',
      );
    }

    const game = await this.prisma.$transaction(async (tx) => {
      // 같은 모임의 조합 생성은 한 줄로 세운다 — 운영진 두 명이 동시에 같은 추천을 넣어도 중복 검사가 서로를 본다
      await this.lockSession(tx, sessionId);
      await this.assertNotDuplicate(tx, sessionId, uniqueIds);

      const created = await tx.game.create({
        data: {
          sessionId,
          queueOrder: await this.nextQueueOrder(tx, sessionId), // 대기 조합 큐의 맨 뒤
          players: {
            createMany: {
              data: uniqueIds.map((attendanceId, slot) => ({ attendanceId, slot })), // 고른 순서대로 자리 — 0·1 한 팀, 2·3 상대
            },
          },
        },
        include: GAME_INCLUDE,
      });

      // 미배정 대기자만 MATCHED로 승격 — 이미 MATCHED(다른 조합)·PLAYING인 사람은 그대로
      await tx.attendance.updateMany({
        where: { id: { in: uniqueIds }, status: 'CHECKED_IN' },
        data: { status: 'MATCHED' },
      });
      return created;
    });
    this.realtime.broadcastSnapshot(sessionId);
    this.push.notifyGame(game.id); // 4명에게 "다음 게임 조합에 들어갔어요"
    return toGameResponse(game);
  }

  // 코트 배정: QUEUED → PLAYING, 코트 IN_GAME, 4명 PLAYING, 경과 시간 기준점(startedAt) 기록
  async assign(id: string, dto: AssignGameDto): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합 상태의 게임만 코트에 배정할 수 있습니다.');
    }
    if (game.players.length < GAME_SIZE) {
      throw new ConflictException('4명이 다 차야 코트에 배정할 수 있어요.');
    }

    const court = await this.prisma.court.findFirst({
      where: { id: dto.courtId, sessionId: game.sessionId, deletedAt: null },
    });
    if (!court) {
      throw new NotFoundException('등록된 코트를 찾을 수 없습니다.');
    }
    if (court.status !== 'IDLE') {
      throw new ConflictException('이미 게임이 진행 중인 코트입니다.');
    }
    // 공유 코트는 차례를 지킨다 — 상대 게임이 끝났으면 코트 카드의 [우리 차례] 탭이 먼저
    if (court.isShared && !court.ourTurn) {
      throw new ConflictException(
        '다른 모임 차례인 코트입니다. 상대 게임이 끝났다면 코트의 [우리 차례]를 먼저 눌러주세요.',
      );
    }

    // 중복 대기 정책상 다른 코트에서 게임 중인 사람이 이 조합에 있을 수 있다 — PLAYING은 동시에 한 곳만
    const busyNames = game.players
      .filter((player) => player.attendance.status === 'PLAYING')
      .map((player) => player.attendance.member.name);
    if (busyNames.length > 0) {
      throw new ConflictException(
        `아직 게임 중인 모임원이 있습니다: ${busyNames.join(', ')}. 해당 게임 종료 후 배정해주세요.`,
      );
    }

    const assigned = await this.startOnCourt(id, court.id, game.players.map((p) => p.attendanceId));
    this.realtime.broadcastSnapshot(game.sessionId);
    this.push.notifyGame(id); // 4명에게 "N번 코트로 오세요"
    return toGameResponse(assigned);
  }

  // 빈 코트 채우기 — 빈 코트(번호 순)에 대기 조합(순서대로)을 한 번에 배정한다
  // 가능한 것만 넣는다: 다른 코트에서 게임 중인 사람이 든 조합은 건너뛰고 다음 조합을 넣는다(코트를 놀리지 않게)
  async fillCourts(sessionId: string): Promise<IFillCourtsResult> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const courts = (
      await this.prisma.court.findMany({
        where: { sessionId, deletedAt: null, status: 'IDLE' },
        orderBy: { courtNo: 'asc' },
      })
    ).filter((court) => !court.isShared || court.ourTurn); // 다른 모임 차례인 공유 코트는 제외
    // 빈칸 있는 조합은 운영진이 아직 짜는 중 — 건너뜀 안내 없이 뺀다
    const queued = (
      await this.prisma.game.findMany({
        where: { sessionId, status: 'QUEUED' },
        orderBy: { queueOrder: 'asc' },
        include: GAME_INCLUDE,
      })
    ).filter((game) => game.players.length === GAME_SIZE);

    const result: IFillCourtsResult = { assigned: [], skipped: [] };
    // 이번 채우기에서 코트에 들어간 사람도 "게임 중" — 겹친 뒤 조합이 같은 사람을 또 넣지 않게
    const busy = new Set(
      queued.flatMap((g) => g.players.filter((p) => p.attendance.status === 'PLAYING').map((p) => p.attendanceId)),
    );
    for (const game of queued) {
      if (courts.length === 0) break;
      const blocked = game.players.filter((p) => busy.has(p.attendanceId)).map((p) => p.attendance.member.name);
      if (blocked.length > 0) {
        result.skipped.push({ gameId: game.id, reason: `${blocked.join(', ')} 게임 중` });
        continue;
      }
      const court = courts.shift()!;
      const attendanceIds = game.players.map((p) => p.attendanceId);
      try {
        await this.startOnCourt(game.id, court.id, attendanceIds);
      } catch (error) {
        // 다른 기기가 먼저 배정한 경우 등 — 이 조합만 건너뛰고 계속
        result.skipped.push({
          gameId: game.id,
          reason: error instanceof HttpException ? error.message : '배정하지 못했어요',
        });
        continue;
      }
      attendanceIds.forEach((id) => busy.add(id));
      result.assigned.push({
        gameId: game.id,
        courtNo: court.courtNo,
        names: game.players.map((p) => p.attendance.member.name),
      });
    }

    if (result.assigned.length > 0) {
      this.realtime.broadcastSnapshot(sessionId);
      result.assigned.forEach((a) => this.push.notifyGame(a.gameId));
    }
    return result;
  }

  // 배정 실행(검증 끝난 뒤) — 코트·게임 상태를 조건부로 바꿔, 그 사이 다른 기기가 먼저 배정했으면 409
  private startOnCourt(gameId: string, courtId: string, attendanceIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const court = await tx.court.updateMany({
        where: { id: courtId, status: 'IDLE' },
        data: { status: 'IN_GAME' },
      });
      const game = await tx.game.updateMany({
        where: { id: gameId, status: 'QUEUED' },
        data: {
          status: 'PLAYING',
          courtId,
          startedAt: new Date(),
          queueOrder: null, // 큐에서 빠졌으므로 순서 제거
        },
      });
      if (court.count === 0 || game.count === 0) {
        throw new ConflictException('이미 다른 곳에서 배정된 코트나 조합입니다.');
      }
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: { status: 'PLAYING' },
      });
      return tx.game.findUniqueOrThrow({ where: { id: gameId }, include: GAME_INCLUDE });
    });
  }

  // 게임 종료: PLAYING → FINISHED, 코트 IDLE, 4명 대기 복귀(맨 뒤) + 게임 횟수 +1
  async finish(id: string): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('진행 중인 게임만 종료할 수 있습니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const finished = await this.prisma.$transaction(async (tx) => {
      // 공유 코트면 우리 차례 소진 — 다음은 다른 모임 (퐁당퐁당). 연속으로 치기로 했으면
      // 운영진이 코트 카드에서 [우리 차례]로 되돌린다 (퐁퐁당도 이 조작으로 커버)
      const court = await tx.court.findUniqueOrThrow({
        where: { id: game.courtId as string }, // PLAYING 게임은 항상 코트를 갖는다
      });
      await tx.court.update({
        where: { id: court.id },
        data: { status: 'IDLE', ...(court.isShared ? { ourTurn: false } : {}) },
      });
      // 전원 공통: 방금 뛰었으므로 대기 시간 리셋(대기 목록 맨 뒤) + 게임 횟수 +1
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: { waitingSince: new Date(), gamesPlayed: { increment: 1 } },
      });
      // 중복 대기 허용 — 다른 QUEUED 조합에 남아있으면 MATCHED 유지, 아니면 대기 복귀
      const buckets = await this.splitByRemainingActiveGames(tx, attendanceIds, id);
      if (buckets.matched.length > 0) {
        await tx.attendance.updateMany({
          where: { id: { in: buckets.matched } },
          data: { status: 'MATCHED' },
        });
      }
      if (buckets.waiting.length > 0) {
        await tx.attendance.updateMany({
          where: { id: { in: buckets.waiting } },
          data: { status: 'CHECKED_IN' },
        });
      }
      return tx.game.update({
        where: { id },
        data: { status: 'FINISHED', endedAt: new Date() },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(finished);
  }

  // 배정 취소: 조합은 유지한 채 게임 중 → 대기 조합(큐 맨 뒤)으로 되돌린다
  // (코트 오배정·순서 미루기용 — cancel과 달리 4인 조합이 풀리지 않음)
  async unassign(id: string): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('진행 중인 게임만 대기 조합으로 되돌릴 수 있습니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const unassigned = await this.prisma.$transaction(async (tx) => {
      await tx.court.update({
        where: { id: game.courtId as string },
        data: { status: 'IDLE' },
      });
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: { status: 'MATCHED' },
      });
      return tx.game.update({
        where: { id },
        data: {
          status: 'QUEUED',
          courtId: null,
          startedAt: null, // 다시 배정되면 타이머는 새로 시작
          queueOrder: await this.nextQueueOrder(tx, game.sessionId),
        },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(unassigned);
  }

  // 조합 해체: 잘못 짠 조합(QUEUED)이나 잘못 시작한 게임(PLAYING)을 되돌린다
  // finish와 달리 게임 횟수를 올리지 않고, 대기 시간도 원래 것을 유지한다
  async cancel(id: string): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED' && game.status !== 'PLAYING') {
      throw new ConflictException('이미 종료되었거나 해체된 게임입니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const canceled = await this.prisma.$transaction(async (tx) => {
      if (game.courtId) {
        await tx.court.update({
          where: { id: game.courtId },
          data: { status: 'IDLE' },
        });
      }
      // 중복 대기 허용 — 이 게임만 해체하고, 각자의 상태는 남은 활성 게임 기준으로 재계산
      // (다른 코트에서 PLAYING 중이면 건드리지 않고, 다른 QUEUED 조합에 있으면 MATCHED 유지)
      const buckets = await this.splitByRemainingActiveGames(tx, attendanceIds, id);
      if (buckets.matched.length > 0) {
        await tx.attendance.updateMany({
          where: { id: { in: buckets.matched } },
          data: { status: 'MATCHED' },
        });
      }
      if (buckets.waiting.length > 0) {
        await tx.attendance.updateMany({
          where: { id: { in: buckets.waiting } },
          data: { status: 'CHECKED_IN' },
        });
      }
      return tx.game.update({
        where: { id },
        data: { status: 'CANCELED', queueOrder: null },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(canceled);
  }

  // 선수 교체: 부상·급한 일로 게임 중(PLAYING)이나 대기 조합(QUEUED)에서 한 명만 바꾼다
  // 게임을 갈아엎지 않으므로 타이머·큐 순서가 유지된다. 빠진 사람은 대기 복귀(대기 시간 보존)
  async replacePlayer(id: string, dto: ReplaceGamePlayerDto): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED' && game.status !== 'PLAYING') {
      throw new ConflictException('이미 종료되었거나 해체된 게임입니다.');
    }
    if (dto.outAttendanceId === dto.inAttendanceId) {
      throw new BadRequestException('같은 모임원으로는 교체할 수 없습니다.');
    }
    if (!game.players.some((player) => player.attendanceId === dto.outAttendanceId)) {
      throw new ConflictException('빠질 모임원이 이 게임에 없습니다.');
    }
    if (game.players.some((player) => player.attendanceId === dto.inAttendanceId)) {
      throw new ConflictException('이미 이 게임에 있는 모임원입니다.');
    }

    const incoming = await this.prisma.attendance.findFirst({
      where: {
        id: dto.inAttendanceId,
        sessionId: game.sessionId,
        status: { notIn: ['LEFT', 'RESTING'] },
        shuttleConfirmedAt: { not: null }, // 콕 미확인은 교체 투입도 불가
      },
    });
    if (!incoming) {
      throw new ConflictException(
        '콕 미확인·퇴장·휴식 중이거나 이 모임에 없는 모임원입니다.',
      );
    }
    // PLAYING은 동시에 한 곳만 — 게임 중인 게임엔 다른 코트에서 뛰는 중인 사람 투입 불가
    // (QUEUED 조합엔 중복 대기 정책상 게임 중인 사람도 미리 넣을 수 있다)
    if (game.status === 'PLAYING' && incoming.status === 'PLAYING') {
      throw new ConflictException('이미 다른 코트에서 게임 중인 모임원입니다.');
    }

    const replaced = await this.prisma.$transaction(async (tx) => {
      // 들어오는 사람은 나간 사람 자리에 — 팀이 바뀌지 않게
      const outSlot = withSlots(game.players).find((p) => p.attendanceId === dto.outAttendanceId)?.slot ?? null;
      await tx.gamePlayer.deleteMany({
        where: { gameId: id, attendanceId: dto.outAttendanceId },
      });
      await tx.gamePlayer.create({
        data: { gameId: id, attendanceId: dto.inAttendanceId, slot: outSlot },
      });

      // 들어오는 사람: 게임 중 게임이면 즉시 PLAYING, 대기 조합이면 미배정자만 MATCHED 승격
      if (game.status === 'PLAYING') {
        await tx.attendance.update({
          where: { id: dto.inAttendanceId },
          data: { status: 'PLAYING' },
        });
      } else if (incoming.status === 'CHECKED_IN') {
        await tx.attendance.update({
          where: { id: dto.inAttendanceId },
          data: { status: 'MATCHED' },
        });
      }

      // 빠지는 사람: 남은 활성 게임 기준으로 상태 재계산 (대기 시간은 보존 — 오래 기다린 이력 유지)
      const buckets = await this.splitByRemainingActiveGames(tx, [dto.outAttendanceId], id);
      if (buckets.matched.length > 0 || buckets.waiting.length > 0) {
        await tx.attendance.update({
          where: { id: dto.outAttendanceId },
          data: { status: buckets.matched.length > 0 ? 'MATCHED' : 'CHECKED_IN' },
        });
      }

      return tx.game.findUniqueOrThrow({ where: { id }, include: GAME_INCLUDE });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    this.push.notifyGame(id, dto.inAttendanceId); // 새로 들어온 1명에게만 — 게임 상태에 맞는 문구
    return toGameResponse(replaced);
  }

  // 빈칸 있는 조합 시작 — 관제판에서 첫 사람을 새 조합 자리에 놓으면 1명 + 빈칸 3개로 큐 맨 뒤에 생긴다
  // 4명이 차기 전까지는 알림을 보내지 않는다(짜는 중인 조합이 모임원에게 보이지 않게)
  async createDraft(sessionId: string, dto: CreateDraftGameDto): Promise<IGame> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const attendance = await this.findPlayableAttendance(sessionId, dto.attendanceId);

    const game = await this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, sessionId);
      const created = await tx.game.create({
        data: {
          sessionId,
          queueOrder: await this.nextQueueOrder(tx, sessionId),
          players: { create: { attendanceId: attendance.id, slot: 0 } },
        },
        include: GAME_INCLUDE,
      });
      if (attendance.status === 'CHECKED_IN') {
        await tx.attendance.update({ where: { id: attendance.id }, data: { status: 'MATCHED' } });
      }
      return created;
    });
    this.realtime.broadcastSnapshot(sessionId);
    return toGameResponse(game);
  }

  // 대기 조합 빈칸에 한 명 넣기 — 4명이 되는 순간 일반 조합: 같은 4명 중복 검사 + 4명에게 알림
  async addPlayer(id: string, dto: AddGamePlayerDto): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합에만 사람을 넣을 수 있어요. 게임 중이면 교체를 써주세요.');
    }
    const attendance = await this.findPlayableAttendance(game.sessionId, dto.attendanceId);

    const updated = await this.prisma.$transaction(async (tx) => {
      // 운영진 둘이 같은 빈칸을 동시에 채워 5명이 되지 않게 — 잠근 뒤 선수 수를 다시 센다
      await this.lockSession(tx, game.sessionId);
      const current = await tx.game.findUniqueOrThrow({
        where: { id },
        select: { status: true, players: { select: { attendanceId: true, slot: true } } },
      });
      if (current.status !== 'QUEUED') {
        throw new ConflictException('이미 코트에 배정되었거나 해체된 조합이에요.');
      }
      const ids = current.players.map((p) => p.attendanceId);
      if (ids.includes(attendance.id)) {
        throw new ConflictException('이미 이 조합에 있는 모임원이에요.');
      }
      if (ids.length >= GAME_SIZE) {
        throw new ConflictException('이미 4명이 다 찬 조합이에요. 바꾸려면 그 사람 위에 놓아 교체해주세요.');
      }
      if (ids.length + 1 === GAME_SIZE) {
        await this.assertNotDuplicate(tx, game.sessionId, [...ids, attendance.id], id);
      }
      // 놓은 빈자리에 — 지정이 없거나 이미 찼으면 첫 빈자리
      const slot = pickFreeSlot(current.players, dto.slot);
      await tx.gamePlayer.create({ data: { gameId: id, attendanceId: attendance.id, slot } });
      if (attendance.status === 'CHECKED_IN') {
        await tx.attendance.update({ where: { id: attendance.id }, data: { status: 'MATCHED' } });
      }
      return tx.game.findUniqueOrThrow({ where: { id }, include: GAME_INCLUDE });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    if (updated.players.length === GAME_SIZE) this.push.notifyGame(id); // 4명이 다 찼을 때만 "조합에 들어갔어요"
    return toGameResponse(updated);
  }

  // 대기 조합에서 한 명 빼기 — 그 자리는 빈칸이 된다(4명 조합도 3명 + 빈칸으로). 아무도 안 남으면 조합 해체
  // 빠진 사람은 교체·해체와 같이 남은 활성 게임 기준으로 상태를 다시 정한다(대기 시간 보존)
  async removePlayer(id: string, attendanceId: string): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합에서만 뺄 수 있어요. 게임 중이면 교체를 써주세요.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, game.sessionId);
      const removed = await tx.gamePlayer.deleteMany({ where: { gameId: id, attendanceId } });
      if (removed.count === 0) {
        throw new ConflictException('이 조합에 없는 모임원이에요.');
      }
      const buckets = await this.splitByRemainingActiveGames(tx, [attendanceId], id);
      if (buckets.matched.length > 0 || buckets.waiting.length > 0) {
        await tx.attendance.update({
          where: { id: attendanceId },
          data: { status: buckets.matched.length > 0 ? 'MATCHED' : 'CHECKED_IN' },
        });
      }
      const left = await tx.gamePlayer.count({ where: { gameId: id } });
      return tx.game.update({
        where: { id },
        data: left === 0 ? { status: 'CANCELED', queueOrder: null } : {},
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(updated);
  }

  // 대기 조합 전체 순서를 한 번에 — 끌어서 놓은 최종 순서. 그 사이 다른 기기에서 조합이 생기거나 빠졌으면 409(새 화면으로 다시)
  async reorder(sessionId: string, dto: ReorderGamesDto): Promise<IGame[]> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const games = await this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, sessionId);
      const queued = await tx.game.findMany({
        where: { sessionId, status: 'QUEUED' },
        select: { id: true },
      });
      const queuedIds = new Set(queued.map((g) => g.id));
      if (queued.length !== dto.gameIds.length || dto.gameIds.some((gameId) => !queuedIds.has(gameId))) {
        throw new ConflictException('그 사이 대기 조합이 바뀌었어요. 다시 시도해주세요.');
      }
      for (const [index, gameId] of dto.gameIds.entries()) {
        await tx.game.update({ where: { id: gameId }, data: { queueOrder: index + 1 } });
      }
      return tx.game.findMany({
        where: { sessionId, status: 'QUEUED' },
        orderBy: { queueOrder: 'asc' },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(sessionId);
    return games.map(toGameResponse);
  }

  // 코트 [다시 알림] — 배정됐는데 안 오는 사람이 있을 때 4명에게 배정 알림을 다시 보낸다
  async renotify(id: string): Promise<IPushCallResult> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('코트에 배정된 게임만 다시 알릴 수 있습니다.');
    }
    if (!renotifyCooldown.tryAcquire(id)) {
      throw new HttpException('방금 알렸어요. 30초 뒤에 다시 시도해주세요.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return { devices: await this.push.resendGame(id) };
  }

  // 대기 조합 순서 변경 — 클라이언트가 계산한 목표 순서를 그대로 반영
  async updateOrder(id: string, dto: UpdateGameOrderDto): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합 상태의 게임만 순서를 바꿀 수 있습니다.');
    }
    const updated = await this.prisma.game.update({
      where: { id },
      data: { queueOrder: dto.queueOrder },
      include: GAME_INCLUDE,
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(updated);
  }

  // 같은 모임의 조합 변경을 한 줄로 세운다(트랜잭션이 끝나면 풀림) — 동시에 눌러도 중복·5명째가 생기지 않게
  private async lockSession(tx: Prisma.TransactionClient, sessionId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
  }

  // 대기 조합 큐의 맨 뒤 순서
  private async nextQueueOrder(tx: Prisma.TransactionClient, sessionId: string) {
    const lastQueued = await tx.game.findFirst({
      where: { sessionId, status: 'QUEUED' },
      orderBy: { queueOrder: 'desc' },
      select: { queueOrder: true },
    });
    return (lastQueued?.queueOrder ?? 0) + 1;
  }

  // 똑같은 4명이 이미 대기 조합에 있으면 막는다(두 기기에서 같은 "남복 짜줘"를 넣는 경우 등) — 겹침 허용과는 별개
  private async assertNotDuplicate(
    tx: Prisma.TransactionClient,
    sessionId: string,
    attendanceIds: string[],
    excludeGameId?: string,
  ) {
    const key = [...attendanceIds].sort().join('|');
    const queuedGames = await tx.game.findMany({
      where: { sessionId, status: 'QUEUED', ...(excludeGameId && { id: { not: excludeGameId } }) },
      select: { players: { select: { attendanceId: true } } },
    });
    if (queuedGames.some((g) => g.players.map((p) => p.attendanceId).sort().join('|') === key)) {
      throw new ConflictException('같은 4명 조합이 이미 대기 중이에요.');
    }
  }

  // 조합에 넣을 수 있는 사람 — 이 모임 출석자 중 콕 확인됐고 퇴장·휴식이 아닌 사람(게임 중·다른 조합은 겹침 허용)
  private async findPlayableAttendance(sessionId: string, attendanceId: string) {
    const attendance = await this.prisma.attendance.findFirst({
      where: {
        id: attendanceId,
        sessionId,
        status: { notIn: ['LEFT', 'RESTING'] },
        shuttleConfirmedAt: { not: null },
      },
    });
    if (!attendance) {
      throw new ConflictException('콕 미확인·퇴장·휴식 중이거나 이 모임에 없는 모임원입니다.');
    }
    return attendance;
  }

  // 특정 게임에서 빠지는 인원들의 다음 상태를 "남은 활성 게임" 기준으로 분류한다
  // playing: 다른 코트에서 게임 중(상태 변경 금지) / matched: 다른 QUEUED 조합 잔존 / waiting: 완전히 자유
  private async splitByRemainingActiveGames(
    tx: Prisma.TransactionClient,
    attendanceIds: string[],
    excludeGameId: string,
  ): Promise<{ playing: string[]; matched: string[]; waiting: string[] }> {
    const remaining = await tx.gamePlayer.findMany({
      where: {
        attendanceId: { in: attendanceIds },
        gameId: { not: excludeGameId },
        game: { status: { in: ['QUEUED', 'PLAYING'] } },
      },
      select: { attendanceId: true, game: { select: { status: true } } },
    });

    const playingSet = new Set<string>();
    const queuedSet = new Set<string>();
    for (const row of remaining) {
      (row.game.status === 'PLAYING' ? playingSet : queuedSet).add(row.attendanceId);
    }
    return {
      playing: attendanceIds.filter((id) => playingSet.has(id)),
      matched: attendanceIds.filter((id) => !playingSet.has(id) && queuedSet.has(id)),
      waiting: attendanceIds.filter((id) => !playingSet.has(id) && !queuedSet.has(id)),
    };
  }

  private async findGameOrThrow(id: string) {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: GAME_INCLUDE,
    });
    if (!game) {
      throw new NotFoundException('게임을 찾을 수 없습니다.');
    }
    return game;
  }
}
