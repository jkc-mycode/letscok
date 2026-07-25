import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { RecommendationsService } from './recommendations.service';

// 추천 종목 탭 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다
// (category 필터가 풀·구성·점수를 올바르게 제한하는지 + ALL 기존 동작 회귀)

// 브로드캐스트는 추천과 무관 — 소켓 없이 서비스만 조립하기 위한 스텁
const realtimeStub = {
  broadcastSnapshot: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();
const sessionsService = new SessionsService(prisma, realtimeStub);
const service = new RecommendationsService(prisma, sessionsService);

let seq = 0; // 회원 이름 중복 방지용 일련번호

async function seedSession() {
  return prisma.session.create({
    data: { date: new Date('2026-01-01'), checkInCode: '0101' },
  });
}

// 성별 지정 회원 + 출석 1행 — gender: null = 미지정
async function seedAttendance(
  sessionId: string,
  gender: 'MALE' | 'FEMALE' | null,
  status: 'CHECKED_IN' | 'MATCHED' | 'PLAYING' = 'CHECKED_IN',
) {
  const member = await prisma.member.create({
    data: {
      name: `테스트${++seq}`,
      grade: 'C',
      gender,
      birthDate: new Date('2000-01-01'),
    },
  });
  return prisma.attendance.create({
    data: {
      sessionId,
      memberId: member.id,
      status,
      waitingSince: new Date('2026-01-01T10:00:00Z'),
      shuttleConfirmedAt: new Date('2026-01-01T09:00:00Z'), // 추천 풀은 콕 확인자만 — 기본 확인 상태로 시드
    },
    include: { member: true },
  });
}

// 후보 4인의 성별 구성 (남성 수, 여성 수, 미지정 수)
function composition(players: { gender: string | null }[]) {
  let m = 0;
  let f = 0;
  let u = 0;
  for (const p of players) {
    if (p.gender === 'MALE') m++;
    else if (p.gender === 'FEMALE') f++;
    else u++;
  }
  return { m, f, u };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('recommend — category 필터', () => {
  it('ALL(기본): 미지정 포함 풀에서 후보를 만든다 (기존 동작 회귀)', async () => {
    const session = await seedSession();
    await Promise.all([
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, null), // 미지정도 ALL에서는 후보에 들어간다
    ]);

    const results = await service.recommend(session.id);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].players).toHaveLength(4); // 4명뿐이라 미지정 포함 확정
    expect(composition(results[0].players).u).toBe(1);
  });

  it('MENS: 남성만으로 구성하고 여성·미지정은 배제한다', async () => {
    const session = await seedSession();
    await Promise.all([
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, null),
    ]);

    const results = await service.recommend(session.id, 'MENS');

    expect(results.length).toBeGreaterThan(0);
    for (const rec of results) {
      expect(composition(rec.players)).toEqual({ m: 4, f: 0, u: 0 });
    }
  });

  it('WOMENS: 여성이 4명 미만이면 빈 배열', async () => {
    const session = await seedSession();
    await Promise.all([
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'MALE'), // 남성·미지정으로는 여복을 못 채운다
      seedAttendance(session.id, null),
    ]);

    const results = await service.recommend(session.id, 'WOMENS');
    expect(results).toEqual([]);
  });

  it('MIXED: 모든 후보가 정확히 2:2 (미지정 제외)', async () => {
    const session = await seedSession();
    await Promise.all([
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, null),
    ]);

    const results = await service.recommend(session.id, 'MIXED');

    expect(results.length).toBeGreaterThan(0);
    for (const rec of results) {
      expect(composition(rec.players)).toEqual({ m: 2, f: 2, u: 0 });
    }
  });

  it('OTHER: 모든 후보가 3:1 또는 1:3 (2:2·4:0은 제외)', async () => {
    const session = await seedSession();
    await Promise.all([
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'FEMALE'),
    ]);

    const results = await service.recommend(session.id, 'OTHER');

    expect(results.length).toBeGreaterThan(0);
    for (const rec of results) {
      const { m, f, u } = composition(rec.players);
      expect(u).toBe(0);
      expect((m === 3 && f === 1) || (m === 1 && f === 3)).toBe(true);
    }
  });

  it('차용 모드에서도 종목 구성 유지 — 여복 탭은 여성만 차용한다', async () => {
    const session = await seedSession();
    // 미배정 여성 1명 + 게임/조합에 묶인 여성 3명 + 묶인 남성 2명
    const freeFemale = await seedAttendance(session.id, 'FEMALE', 'CHECKED_IN');
    await Promise.all([
      seedAttendance(session.id, 'FEMALE', 'PLAYING'),
      seedAttendance(session.id, 'FEMALE', 'MATCHED'),
      seedAttendance(session.id, 'FEMALE', 'PLAYING'),
      seedAttendance(session.id, 'MALE', 'PLAYING'),
      seedAttendance(session.id, 'MALE', 'MATCHED'),
    ]);

    const results = await service.recommend(session.id, 'WOMENS');

    expect(results.length).toBeGreaterThan(0);
    for (const rec of results) {
      expect(composition(rec.players)).toEqual({ m: 0, f: 4, u: 0 });
      // 미배정 여성은 항상 고정 선발, 나머지 3명은 차용 표시
      expect(rec.players.some((p) => p.attendanceId === freeFemale.id)).toBe(true);
      expect(rec.players.filter((p) => p.borrowedFrom !== null)).toHaveLength(3);
    }
  });
});
