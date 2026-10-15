import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 게임 진행(GamesService)과 조합 편집(GameRosterService)이 함께 쓰는 조회·트랜잭션 도우미

// 게임 조회 시 항상 플레이어+회원까지 포함 (보드 렌더링 단위)
export const GAME_INCLUDE = {
  players: { include: { attendance: { include: { member: true } } } },
} as const;

export async function findGameOrThrow(prisma: PrismaService, id: string) {
  const game = await prisma.game.findUnique({
    where: { id },
    include: GAME_INCLUDE,
  });
  if (!game) {
    throw new NotFoundException('게임을 찾을 수 없습니다.');
  }
  return game;
}

// 조합에 넣을 수 있는 사람 — 이 모임 출석자 중 콕 확인됐고 퇴장·휴식이 아닌 사람(게임 중·다른 조합은 겹침 허용)
export async function findPlayableAttendance(prisma: PrismaService, sessionId: string, attendanceId: string) {
  const attendance = await prisma.attendance.findFirst({
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

// 같은 모임의 조합 변경을 한 줄로 세운다(트랜잭션이 끝나면 풀림) — 동시에 눌러도 중복·5명째가 생기지 않게
export async function lockSession(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
}

// 대기 조합 큐의 맨 뒤 순서
export async function nextQueueOrder(tx: Prisma.TransactionClient, sessionId: string) {
  const lastQueued = await tx.game.findFirst({
    where: { sessionId, status: 'QUEUED' },
    orderBy: { queueOrder: 'desc' },
    select: { queueOrder: true },
  });
  return (lastQueued?.queueOrder ?? 0) + 1;
}

// 똑같은 4명이 이미 대기 조합에 있으면 막는다(두 기기에서 같은 "남복 짜줘"를 넣는 경우 등) — 겹침 허용과는 별개
export async function assertNotDuplicate(
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

// 게임에서 빠지는 사람들의 상태를 남은 게임 기준으로 되돌린다(종료·취소·교체·빼기 공통) — 중복 대기 허용 정책
// 다른 코트에서 게임 중이면 그대로 / 다른 대기 조합에 남아 있으면 MATCHED / 어디에도 없으면 대기(CHECKED_IN)
export async function releaseFromGame(tx: Prisma.TransactionClient, attendanceIds: string[], excludeGameId: string) {
  const remaining = await tx.gamePlayer.findMany({
    where: {
      attendanceId: { in: attendanceIds },
      gameId: { not: excludeGameId },
      game: { status: { in: ['QUEUED', 'PLAYING'] } },
    },
    select: { attendanceId: true, game: { select: { status: true } } },
  });
  const playing = new Set(remaining.filter((r) => r.game.status === 'PLAYING').map((r) => r.attendanceId));
  const queued = new Set(remaining.map((r) => r.attendanceId));
  const matched = attendanceIds.filter((id) => !playing.has(id) && queued.has(id));
  const waiting = attendanceIds.filter((id) => !queued.has(id));
  if (matched.length > 0) {
    await tx.attendance.updateMany({ where: { id: { in: matched } }, data: { status: 'MATCHED' } });
  }
  if (waiting.length > 0) {
    await tx.attendance.updateMany({ where: { id: { in: waiting } }, data: { status: 'CHECKED_IN' } });
  }
}
