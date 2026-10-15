import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface MemberAttendanceStat {
  totalSessions: number;
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
    filter.since ? Prisma.sql`s."date" >= ${filter.since}` : null,
    filter.memberIds ? Prisma.sql`a."memberId" IN (${Prisma.join(filter.memberIds)})` : null,
  ].filter((c): c is Prisma.Sql => c !== null);
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

  const rows = await prisma.$queryRaw<({ memberId: string } & MemberAttendanceStat)[]>`
    SELECT a."memberId" AS "memberId",
           COUNT(*)::int AS "totalSessions",
           COALESCE(SUM(a."gamesPlayed"), 0)::int AS "totalGames",
           MAX(s."date") AS "lastDate"
    FROM attendances a
    JOIN sessions s ON s.id = a."sessionId"
    ${where}
    GROUP BY a."memberId"`;
  return new Map(rows.map(({ memberId, ...stat }) => [memberId, stat]));
}
