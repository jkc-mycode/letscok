import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IGame } from '@letscok/shared-types';
import { Prisma } from '../generated/prisma/client';
import { toGameResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  AssignGameDto,
  CreateGameDto,
  ReplaceGamePlayerDto,
  UpdateGameOrderDto,
} from './dto/game.dtos';

// 게임 조회 시 항상 플레이어+회원까지 포함 (보드 렌더링 단위)
const GAME_INCLUDE = {
  players: { include: { attendance: { include: { member: true } } } },
} as const;

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly realtime: RealtimeService,
  ) {}

  // 조합 생성: 4명 → QUEUED 게임. 중복 대기 허용 정책 —
  // 한 사람이 여러 QUEUED 게임에 동시에 들어갈 수 있고(다음다음 게임 미리 짜기),
  // 게임 중(PLAYING)인 사람도 미리 넣을 수 있다. 퇴장(LEFT)한 사람만 불가
  async create(sessionId: string, dto: CreateGameDto): Promise<IGame> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const uniqueIds = [...new Set(dto.attendanceIds)];
    if (uniqueIds.length !== 4) {
      throw new BadRequestException('같은 모임원이 중복 선택되었습니다.');
    }

    const activeCount = await this.prisma.attendance.count({
      where: { id: { in: uniqueIds }, sessionId, status: { not: 'LEFT' } },
    });
    if (activeCount !== 4) {
      throw new ConflictException('퇴장했거나 이 모임에 없는 모임원이 포함되어 있습니다.');
    }

    const game = await this.prisma.$transaction(async (tx) => {
      // 대기 조합 큐의 맨 뒤에 붙인다
      const lastQueued = await tx.game.findFirst({
        where: { sessionId, status: 'QUEUED' },
        orderBy: { queueOrder: 'desc' },
        select: { queueOrder: true },
      });

      const created = await tx.game.create({
        data: {
          sessionId,
          queueOrder: (lastQueued?.queueOrder ?? 0) + 1,
          players: {
            createMany: {
              data: uniqueIds.map((attendanceId) => ({ attendanceId })),
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
    return toGameResponse(game);
  }

  // 코트 배정: QUEUED → PLAYING, 코트 IN_GAME, 4명 PLAYING, 경과 시간 기준점(startedAt) 기록
  async assign(id: string, dto: AssignGameDto): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합 상태의 게임만 코트에 배정할 수 있습니다.');
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

    // 중복 대기 정책상 다른 코트에서 게임 중인 사람이 이 조합에 있을 수 있다 — PLAYING은 동시에 한 곳만
    const busyNames = game.players
      .filter((player) => player.attendance.status === 'PLAYING')
      .map((player) => player.attendance.member.name);
    if (busyNames.length > 0) {
      throw new ConflictException(
        `아직 게임 중인 모임원이 있습니다: ${busyNames.join(', ')}. 해당 게임 종료 후 배정해주세요.`,
      );
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const assigned = await this.prisma.$transaction(async (tx) => {
      await tx.court.update({
        where: { id: court.id },
        data: { status: 'IN_GAME' },
      });
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: { status: 'PLAYING' },
      });
      return tx.game.update({
        where: { id },
        data: {
          status: 'PLAYING',
          courtId: court.id,
          startedAt: new Date(),
          queueOrder: null, // 큐에서 빠졌으므로 순서 제거
        },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(assigned);
  }

  // 게임 종료: PLAYING → FINISHED, 코트 IDLE, 4명 대기 복귀(맨 뒤) + 게임 횟수 +1
  async finish(id: string): Promise<IGame> {
    const game = await this.findGameOrThrow(id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('진행 중인 게임만 종료할 수 있습니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const finished = await this.prisma.$transaction(async (tx) => {
      await tx.court.update({
        where: { id: game.courtId as string }, // PLAYING 게임은 항상 코트를 갖는다
        data: { status: 'IDLE' },
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
      const lastQueued = await tx.game.findFirst({
        where: { sessionId: game.sessionId, status: 'QUEUED' },
        orderBy: { queueOrder: 'desc' },
        select: { queueOrder: true },
      });
      return tx.game.update({
        where: { id },
        data: {
          status: 'QUEUED',
          courtId: null,
          startedAt: null, // 다시 배정되면 타이머는 새로 시작
          queueOrder: (lastQueued?.queueOrder ?? 0) + 1,
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
      where: { id: dto.inAttendanceId, sessionId: game.sessionId, status: { not: 'LEFT' } },
    });
    if (!incoming) {
      throw new ConflictException('퇴장했거나 이 모임에 없는 모임원입니다.');
    }
    // PLAYING은 동시에 한 곳만 — 게임 중인 게임엔 다른 코트에서 뛰는 중인 사람 투입 불가
    // (QUEUED 조합엔 중복 대기 정책상 게임 중인 사람도 미리 넣을 수 있다)
    if (game.status === 'PLAYING' && incoming.status === 'PLAYING') {
      throw new ConflictException('이미 다른 코트에서 게임 중인 모임원입니다.');
    }

    const replaced = await this.prisma.$transaction(async (tx) => {
      await tx.gamePlayer.deleteMany({
        where: { gameId: id, attendanceId: dto.outAttendanceId },
      });
      await tx.gamePlayer.create({
        data: { gameId: id, attendanceId: dto.inAttendanceId },
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
    return toGameResponse(replaced);
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
