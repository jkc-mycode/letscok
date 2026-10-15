import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { GAME_SIZE, IGame } from '@letscok/shared-types';
import { pickFreeSlot, withSlots } from '../common/utils/game-slots';
import { toGameResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  AddGamePlayerDto,
  CreateDraftGameDto,
  CreateGameDto,
  MoveGameSlotDto,
  ReorderGamesDto,
  ReplaceGamePlayerDto,
} from './dto/game.dtos';
import {
  GAME_INCLUDE,
  findGameOrThrow,
  findPlayableAttendance,
  lockSession,
  nextQueueOrder,
  assertNotDuplicate,
  releaseFromGame,
} from './game-helpers';

// 조합 편집 — 조합 만들기·빈칸 조합·사람 넣기·빼기·자리 옮기기·선수 교체·대기 순서
// 게임을 코트에 올리고 끝내는 쪽은 GamesService

@Injectable()
export class GameRosterService {
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
      await lockSession(tx, sessionId);
      await assertNotDuplicate(tx, sessionId, uniqueIds);

      const created = await tx.game.create({
        data: {
          sessionId,
          queueOrder: await nextQueueOrder(tx, sessionId), // 대기 조합 큐의 맨 뒤
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

  // 빈칸 있는 조합 시작 — 관제판에서 첫 사람을 새 조합 자리에 놓으면 1명 + 빈칸 3개로 큐 맨 뒤에 생긴다
  // 4명이 차기 전까지는 알림을 보내지 않는다(짜는 중인 조합이 모임원에게 보이지 않게)
  async createDraft(sessionId: string, dto: CreateDraftGameDto): Promise<IGame> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const attendance = await findPlayableAttendance(this.prisma, sessionId, dto.attendanceId);

    const game = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const created = await tx.game.create({
        data: {
          sessionId,
          queueOrder: await nextQueueOrder(tx, sessionId),
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
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합에만 사람을 넣을 수 있어요. 게임 중이면 교체를 써주세요.');
    }
    const attendance = await findPlayableAttendance(this.prisma, game.sessionId, dto.attendanceId);

    const updated = await this.prisma.$transaction(async (tx) => {
      // 운영진 둘이 같은 빈칸을 동시에 채워 5명이 되지 않게 — 잠근 뒤 선수 수를 다시 센다
      await lockSession(tx, game.sessionId);
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
        await assertNotDuplicate(tx, game.sessionId, [...ids, attendance.id], id);
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
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합에서만 뺄 수 있어요. 게임 중이면 교체를 써주세요.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, game.sessionId);
      const removed = await tx.gamePlayer.deleteMany({ where: { gameId: id, attendanceId } });
      if (removed.count === 0) {
        throw new ConflictException('이 조합에 없는 모임원이에요.');
      }
      await releaseFromGame(tx, [attendanceId], id);
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

  // 게임 안 자리 옮기기 — 그 자리에 사람이 있으면 맞바꾸고 비어 있으면 옮긴다. 대기 조합·게임 중 모두(코트에서 팀을 바꾸는 경우)
  // 자리가 비어 있던 예전 데이터도 이참에 지금 보이는 자리로 저장한다(바꾼 뒤 순서가 흔들리지 않게)
  async moveSlot(id: string, dto: MoveGameSlotDto): Promise<IGame> {
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'QUEUED' && game.status !== 'PLAYING') {
      throw new ConflictException('끝났거나 해체된 게임이에요.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, game.sessionId);
      const players = withSlots(await tx.gamePlayer.findMany({ where: { gameId: id } }));
      const mover = players.find((p) => p.attendanceId === dto.attendanceId);
      if (!mover) throw new ConflictException('이 게임에 없는 모임원이에요.');
      const occupant = players.find((p) => p.slot === dto.slot && p.id !== mover.id);
      for (const player of players) {
        const slot = player.id === mover.id ? dto.slot : player.id === occupant?.id ? mover.slot : player.slot;
        await tx.gamePlayer.update({ where: { id: player.id }, data: { slot } });
      }
      return tx.game.findUniqueOrThrow({ where: { id }, include: GAME_INCLUDE });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(updated);
  }

  // 선수 교체: 부상·급한 일로 게임 중(PLAYING)이나 대기 조합(QUEUED)에서 한 명만 바꾼다
  // 게임을 갈아엎지 않으므로 타이머·큐 순서가 유지된다. 빠진 사람은 대기 복귀(대기 시간 보존)
  async replacePlayer(id: string, dto: ReplaceGamePlayerDto): Promise<IGame> {
    const game = await findGameOrThrow(this.prisma, id);
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

    const incoming = await findPlayableAttendance(this.prisma, game.sessionId, dto.inAttendanceId);
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

      // 빠지는 사람 (대기 시간은 보존 — 오래 기다린 이력 유지)
      await releaseFromGame(tx, [dto.outAttendanceId], id);

      return tx.game.findUniqueOrThrow({ where: { id }, include: GAME_INCLUDE });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    this.push.notifyGame(id, dto.inAttendanceId); // 새로 들어온 1명에게만 — 게임 상태에 맞는 문구
    return toGameResponse(replaced);
  }

  // 대기 조합 전체 순서를 한 번에 — 끌어서 놓은 최종 순서. 그 사이 다른 기기에서 조합이 생기거나 빠졌으면 409(새 화면으로 다시)
  async reorder(sessionId: string, dto: ReorderGamesDto): Promise<IGame[]> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const games = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
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
}
