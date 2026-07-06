import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IGame } from '@letscok/shared-types';
import { toGameResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { AssignGameDto, CreateGameDto, UpdateGameOrderDto } from './dto/game.dtos';

// 게임 조회 시 항상 플레이어+회원까지 포함 (보드 렌더링 단위)
const GAME_INCLUDE = {
  players: { include: { attendance: { include: { member: true } } } },
} as const;

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {}

  // 조합 생성: 대기(CHECKED_IN) 4명 → QUEUED 게임 + 4명 MATCHED
  async create(sessionId: string, dto: CreateGameDto): Promise<IGame> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const uniqueIds = [...new Set(dto.attendanceIds)];
    if (uniqueIds.length !== 4) {
      throw new BadRequestException('같은 모임원이 중복 선택되었습니다.');
    }

    // 4명 전원이 이 세션의 "미배정 대기" 상태인지 검증
    const waitingCount = await this.prisma.attendance.count({
      where: { id: { in: uniqueIds }, sessionId, status: 'CHECKED_IN' },
    });
    if (waitingCount !== 4) {
      throw new ConflictException(
        '대기 중이 아닌 모임원이 포함되어 있습니다. 대기 인원에서만 조합해주세요.',
      );
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

      await tx.attendance.updateMany({
        where: { id: { in: uniqueIds } },
        data: { status: 'MATCHED' },
      });
      return created;
    });
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
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: {
          status: 'CHECKED_IN',
          waitingSince: new Date(), // 대기 시간 새로 시작 = 대기 목록 맨 뒤
          gamesPlayed: { increment: 1 },
        },
      });
      return tx.game.update({
        where: { id },
        data: { status: 'FINISHED', endedAt: new Date() },
        include: GAME_INCLUDE,
      });
    });
    return toGameResponse(finished);
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
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: { status: 'CHECKED_IN' },
      });
      return tx.game.update({
        where: { id },
        data: { status: 'CANCELED', queueOrder: null },
        include: GAME_INCLUDE,
      });
    });
    return toGameResponse(canceled);
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
    return toGameResponse(updated);
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
