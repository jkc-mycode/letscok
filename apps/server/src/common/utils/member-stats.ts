import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// 출석으로 인정하는 기준 — 체크인만 하고 콕을 내지 않은 사람(구경·착오)은 출석이 아니다
// 기록은 남겨 두고 셀 때만 뺀다. 콕 확인 기능(7/20) 전 기록은 값이 없어 자연히 빠진다
export const COUNTED_ATTENDANCE = { shuttleConfirmedAt: { not: null } } satisfies Prisma.AttendanceWhereInput;

export interface MemberAttendanceStat {
  totalSessions: number; // 출석한 날 수 — 같은 날 두 모임(여복→남복 이동, 1부·2부)은 하루 1회
  totalGames: number;
  lastDate: Date; // 마지막으로 출석한 모임 날짜
}

// 회원별 출석 수·게임 수·마지막 출석일 — 모임원 관리·참여 랭킹·이름 검색이 같이 쓴다
// 출석 기록을 불러오지 않고 DB에서 사람별로 한 번에 센다(기록이 쌓여도 가볍게). 출석이 없는 사람은 결과에 없다
export async function memberAttendanceStats(
  prisma: PrismaService,
  filter: { since?: Date; memberIds?: string[] } = {},
): Promise<Map<string, MemberAttendanceStat>> {
  if (filter.memberIds?.length === 0) return new Map();
  const conditions = [
    Prisma.sql`a."shuttleConfirmedAt" IS NOT NULL`,
    filter.since ? Prisma.sql`s."date" >= ${filter.since}` : null,
    filter.memberIds ? Prisma.sql`a."memberId" IN (${Prisma.join(filter.memberIds)})` : null,
  ].filter((c): c is Prisma.Sql => c !== null);
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

  const rows = await prisma.$queryRaw<({ memberId: string } & MemberAttendanceStat)[]>`
    SELECT a."memberId" AS "memberId",
           COUNT(DISTINCT s."date")::int AS "totalSessions",
           COALESCE(SUM(a."gamesPlayed"), 0)::int AS "totalGames",
           MAX(s."date") AS "lastDate"
    FROM attendances a
    JOIN sessions s ON s.id = a."sessionId"
    ${where}
    GROUP BY a."memberId"`;
  return new Map(rows.map(({ memberId, ...stat }) => [memberId, stat]));
}
