import { Prisma } from '../../generated/prisma/client';

// 같은 키의 요청을 트랜잭션 동안 한 줄로 세운다(끝나면 풀림)
// 모임 단위 잠금(lockSession)으로는 못 막는 모임 사이 검사용 — 여복·남복이 같은 사람·같은 코트 번호를 동시에 잡는 틈
export async function lockKey(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
