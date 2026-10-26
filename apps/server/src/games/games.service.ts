import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GAME_SIZE, IFillCourtsResult, IGame, IPushCallResult } from '@letscok/shared-types';
import { Prisma } from '../generated/prisma/client';
import { toGameResponse } from '../common/mappers/entity.mappers';
import { createCooldown } from '../common/utils/cooldown.util';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { AssignGameDto } from './dto/game.dtos';
import { GAME_INCLUDE, findGameOrThrow, lockSession, nextQueueOrder, releaseFromGame } from './game-helpers';

// 게임 진행 — 코트 배정·옮기기·빈 코트 채우기·종료·되돌리기·대기로·취소·다시 알림
// 조합을 만들고 고치는 쪽은 GameRosterService

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

  // 코트 배정: QUEUED → PLAYING, 코트 IN_GAME, 4명 PLAYING, 경과 시간 기준점(startedAt) 기록
  async assign(id: string, dto: AssignGameDto): Promise<IGame> {
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'QUEUED') {
      throw new ConflictException('대기 조합 상태의 게임만 코트에 배정할 수 있습니다.');
    }
    if (game.players.length < GAME_SIZE) {
      throw new ConflictException('4명이 다 차야 코트에 배정할 수 있어요.');
    }

    const court = await this.findOurCourt(game.sessionId, dto.courtId);
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

    const assigned = await this.startOnCourt(id, court.id, game.players.map((p) => p.attendanceId));
    this.realtime.broadcastSnapshot(game.sessionId);
    this.push.notifyGame(id); // 4명에게 "N번 코트로 오세요"
    return toGameResponse(assigned);
  }

  // 코트 옮기기: 게임 중인 조합을 다른 코트로 — 게임 시간은 이어지고 코트만 바뀐다(대기로 → 다시 배정하면 시간이 0부터)
  // 빈 코트면 원래 코트를 비우고, 게임 중인 코트면 두 게임의 코트를 맞바꾼다(두 코트 모두 계속 게임 중)
  // 공유 코트의 차례는 건드리지 않는다(게임이 끝난 게 아니므로)
  async moveCourt(id: string, dto: AssignGameDto): Promise<IGame> {
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'PLAYING' || !game.courtId) {
      throw new ConflictException('게임 중인 조합만 코트를 옮길 수 있어요.');
    }
    if (game.courtId === dto.courtId) {
      throw new BadRequestException('지금 코트와 같은 코트예요.');
    }
    const court = await this.findOurCourt(game.sessionId, dto.courtId); // 비어 있는지는 트랜잭션 안에서
    const fromCourtId = game.courtId;

    const { moved, swappedId } = await this.prisma.$transaction(async (tx) => {
      // 새 코트가 비어 있으면 차지한다 — 다른 기기가 먼저 배정했으면 아래 맞바꾸기 쪽으로
      const target = await tx.court.updateMany({
        where: { id: court.id, status: 'IDLE' },
        data: { status: 'IN_GAME' },
      });
      const other =
        target.count === 0
          ? await tx.game.findFirst({ where: { courtId: court.id, status: 'PLAYING' }, select: { id: true } })
          : null;
      if (target.count === 0 && !other) throw new ConflictException('이미 게임이 진행 중인 코트입니다.');

      const updated = await tx.game.updateMany({
        where: { id, status: 'PLAYING', courtId: fromCourtId },
        data: { courtId: court.id },
      });
      if (updated.count === 0) throw new ConflictException('이미 끝났거나 옮겨진 게임입니다.');
      if (other) {
        // 상대 게임도 읽은 그대로일 때만 — 그 사이 끝났거나 옮겨졌으면 둘 다 되돌린다
        const swapped = await tx.game.updateMany({
          where: { id: other.id, status: 'PLAYING', courtId: court.id },
          data: { courtId: fromCourtId },
        });
        if (swapped.count === 0) throw new ConflictException('맞바꿀 게임이 그 사이 끝났거나 옮겨졌어요.');
      } else {
        await tx.court.update({ where: { id: fromCourtId }, data: { status: 'IDLE' } });
      }
      return {
        moved: await tx.game.findUniqueOrThrow({ where: { id }, include: GAME_INCLUDE }),
        swappedId: other?.id ?? null,
      };
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    this.push.notifyGame(id); // 4명에게 "N번 코트로 오세요"를 새 코트로
    if (swappedId) this.push.notifyGame(swappedId); // 맞바꾼 상대 4명도 바뀐 코트로
    return toGameResponse(moved);
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
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('진행 중인 게임만 종료할 수 있습니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const finished = await this.prisma.$transaction(async (tx) => {
      // 읽은 뒤 다른 기기가 먼저 종료·이동했으면 여기서 멈춘다 — 두 번 종료되면 게임 수가 2씩 오른다
      await this.claimGame(tx, id, game.status, game.courtId);
      // 공유 코트면 우리 차례 소진 — 다음은 다른 모임 (퐁당퐁당). 연속으로 치기로 했으면
      // 운영진이 코트 카드에서 [우리 차례]로 되돌린다 (퐁퐁당도 이 조작으로 커버)
      const court = await tx.court.findUniqueOrThrow({
        where: { id: game.courtId as string }, // PLAYING 게임은 항상 코트를 갖는다
      });
      await tx.court.update({
        where: { id: court.id },
        data: { status: 'IDLE', ...(court.isShared ? { ourTurn: false } : {}) },
      });
      // 대기 시간을 덮어쓰기 전 값을 남겨 둔다 — 종료 되돌리기가 되살린다
      for (const player of game.players) {
        await tx.gamePlayer.update({
          where: { id: player.id },
          data: { waitingSinceBefore: player.attendance.waitingSince },
        });
      }
      // 전원 공통: 방금 뛰었으므로 대기 시간 리셋(대기 목록 맨 뒤) + 게임 횟수 +1
      await tx.attendance.updateMany({
        where: { id: { in: attendanceIds } },
        data: { waitingSince: new Date(), gamesPlayed: { increment: 1 } },
      });
      await releaseFromGame(tx, attendanceIds, id);
      return tx.game.update({
        where: { id },
        data: { status: 'FINISHED', endedAt: new Date() },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(finished);
  }

  // 종료 되돌리기: [게임 종료]를 잘못 눌렀을 때 — 게임 수·대기 시간·상태를 종료 전으로, 시작 시각은 그대로라 시간이 이어진다
  // 종료 직후 알림 [되돌리기]는 원래 코트로, 게임 기록 길게 누르기는 고른 빈 코트로(원래 코트에 다음 게임이 들어갔어도 살린다).
  // 시간 제한 대신 4명 중 누가 그 뒤 다른 게임을 했거나 휴식·퇴장·게임 중이면 409 (게임 수·대기 기록이 꼬인다)
  async reopen(id: string, courtId?: string): Promise<IGame> {
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'FINISHED' || !game.endedAt || !game.courtId) {
      throw new ConflictException('끝난 게임만 되돌릴 수 있어요.');
    }
    await this.sessionsService.findOpenSessionOrThrow(game.sessionId);
    const moved = game.players.filter(
      (player) => player.attendance.status !== 'CHECKED_IN' && player.attendance.status !== 'MATCHED',
    );
    if (moved.length > 0) {
      const names = moved.map((player) => player.attendance.member.name).join(', ');
      throw new ConflictException(`${names} 님이 이미 다른 상태라 되돌릴 수 없어요.`);
    }
    const attendanceIds = game.players.map((player) => player.attendanceId);
    const playedLater = await this.prisma.gamePlayer.findMany({
      where: {
        attendanceId: { in: attendanceIds },
        game: { id: { not: id }, sessionId: game.sessionId, startedAt: { gt: game.endedAt } },
      },
      select: { attendance: { select: { member: { select: { name: true } } } } },
    });
    if (playedLater.length > 0) {
      const names = [...new Set(playedLater.map((p) => p.attendance.member.name))].join(', ');
      throw new ConflictException(`${names} 님이 그 뒤에 다른 게임을 해서 되돌릴 수 없어요.`);
    }
    // 원래 코트는 종료 때 공유 코트 차례를 넘겼을 수 있어 차례 검사 없이 받는다(되돌리며 우리 차례로 돌린다)
    const targetCourtId = courtId ?? game.courtId;
    if (targetCourtId !== game.courtId) await this.findOurCourt(game.sessionId, targetCourtId);

    const reopened = await this.prisma.$transaction(async (tx) => {
      // 두 기기가 동시에 눌러도 한 번만 — 아직 FINISHED일 때만 바꾼다
      const flipped = await tx.game.updateMany({
        where: { id, status: 'FINISHED' },
        data: { status: 'PLAYING', endedAt: null, courtId: targetCourtId },
      });
      if (flipped.count === 0) throw new ConflictException('끝난 게임만 되돌릴 수 있어요.');
      // 코트는 비어 있을 때만 차지한다 — 확인과 차지를 한 번에 해야 그 사이 다른 기기가 배정해 한 코트에 게임 둘이 생기지 않는다
      const claimed = await tx.court.updateMany({
        where: { id: targetCourtId, status: 'IDLE', deletedAt: null },
        data: { status: 'IN_GAME' },
      });
      if (claimed.count === 0) {
        const court = await tx.court.findUnique({ where: { id: targetCourtId }, select: { courtNo: true } });
        throw new ConflictException(`${court?.courtNo ?? ''}번 코트에 이미 다른 게임이 들어가 되돌릴 수 없어요.`);
      }
      // 공유 코트는 종료 때 넘긴 차례도 다시 우리 것으로
      await tx.court.updateMany({ where: { id: targetCourtId, isShared: true }, data: { ourTurn: true } });
      for (const player of game.players) {
        await tx.attendance.update({
          where: { id: player.attendanceId },
          data: {
            status: 'PLAYING',
            gamesPlayed: { decrement: 1 },
            ...(player.waitingSinceBefore ? { waitingSince: player.waitingSinceBefore } : {}),
          },
        });
      }
      await tx.gamePlayer.updateMany({ where: { gameId: id }, data: { waitingSinceBefore: null } });
      return tx.game.findUniqueOrThrow({ where: { id }, include: GAME_INCLUDE });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    // 다른 코트로 살렸으면 4명에게 새 코트를 알린다(원래 코트면 이미 그 자리에 있다)
    if (targetCourtId !== game.courtId) this.push.notifyGame(id);
    return toGameResponse(reopened);
  }

  // 배정 취소: 조합은 유지한 채 게임 중 → 대기 조합(큐 맨 뒤)으로 되돌린다
  // (코트 오배정·순서 미루기용 — cancel과 달리 4인 조합이 풀리지 않음)
  async unassign(id: string): Promise<IGame> {
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('진행 중인 게임만 대기 조합으로 되돌릴 수 있습니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const unassigned = await this.prisma.$transaction(async (tx) => {
      // 대기 순서 번호를 매기므로 조합 만들기·순서 바꾸기와 같은 모임 잠금 — 동시에 오면 같은 번호가 둘 생겼다
      await lockSession(tx, game.sessionId);
      await this.claimGame(tx, id, game.status, game.courtId);
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
          queueOrder: await nextQueueOrder(tx, game.sessionId),
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
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'QUEUED' && game.status !== 'PLAYING') {
      throw new ConflictException('이미 종료되었거나 해체된 게임입니다.');
    }

    const attendanceIds = game.players.map((player) => player.attendanceId);
    const canceled = await this.prisma.$transaction(async (tx) => {
      await this.claimGame(tx, id, game.status, game.courtId);
      if (game.courtId) {
        await tx.court.update({
          where: { id: game.courtId },
          data: { status: 'IDLE' },
        });
      }
      await releaseFromGame(tx, attendanceIds, id); // 이 게임만 해체 — 다른 조합·게임에 든 사람은 그 상태대로
      return tx.game.update({
        where: { id },
        data: { status: 'CANCELED', queueOrder: null },
        include: GAME_INCLUDE,
      });
    });
    this.realtime.broadcastSnapshot(game.sessionId);
    return toGameResponse(canceled);
  }

  // 코트 [다시 알림] — 배정됐는데 안 오는 사람이 있을 때 4명에게 배정 알림을 다시 보낸다
  async renotify(id: string): Promise<IPushCallResult> {
    const game = await findGameOrThrow(this.prisma, id);
    if (game.status !== 'PLAYING') {
      throw new ConflictException('코트에 배정된 게임만 다시 알릴 수 있습니다.');
    }
    if (!renotifyCooldown.tryAcquire(id)) {
      throw new HttpException('방금 알렸어요. 30초 뒤에 다시 시도해주세요.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return { devices: await this.push.resendGame(id) };
  }

  // 트랜잭션 첫 단계 — 게임이 읽었을 때와 같은 상태·코트일 때만 진행. 행을 잠가서 동시에 온 같은 요청은 뒤에서 기다렸다 409
  // (상태 확인을 트랜잭션 밖에서만 하면 두 기기가 동시에 종료할 때 둘 다 통과한다)
  private async claimGame(
    tx: Prisma.TransactionClient,
    id: string,
    status: Prisma.GameWhereInput['status'],
    courtId: string | null,
  ) {
    // 같은 코트 값을 다시 쓴다 — 바꿀 값이 없으면 UPDATE가 나가지 않아 행이 잠기지 않는다
    const claimed = await tx.game.updateMany({ where: { id, status, courtId }, data: { courtId } });
    if (claimed.count === 0) {
      throw new ConflictException('그 사이 다른 기기에서 바뀐 게임이에요. 화면을 확인해 주세요.');
    }
  }

  // 게임을 넣을 수 있는 우리 코트(배정·옮기기 공통) — 비어 있는지는 부르는 쪽에서 본다
  // 공유 코트는 차례를 지킨다 — 상대 게임이 끝났으면 코트 카드의 [우리 차례] 탭이 먼저
  private async findOurCourt(sessionId: string, courtId: string) {
    const court = await this.prisma.court.findFirst({ where: { id: courtId, sessionId, deletedAt: null } });
    if (!court) {
      throw new NotFoundException('등록된 코트를 찾을 수 없습니다.');
    }
    if (court.isShared && !court.ourTurn) {
      throw new ConflictException(
        '다른 모임 차례인 코트입니다. 상대 게임이 끝났다면 코트의 [우리 차례]를 먼저 눌러주세요.',
      );
    }
    return court;
  }
}
