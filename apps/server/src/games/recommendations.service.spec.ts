import { BadRequestException, ConflictException } from '@nestjs/common';
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
    // 미배정 여성 1명 + 게임 중 여성 3명 + 묶인 남성 2명 (차용은 게임 중인 사람만)
    const freeFemale = await seedAttendance(session.id, 'FEMALE', 'CHECKED_IN');
    await Promise.all([
      seedAttendance(session.id, 'FEMALE', 'PLAYING'),
      seedAttendance(session.id, 'FEMALE', 'PLAYING'),
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

describe('recommend — 잔여 모드 차용 범위', () => {
  // 대기 조합을 순서대로 만든다 — queueOrder로 새 조합(맨 끝)과의 간격이 정해진다
  async function seedQueued(sessionId: string, queueOrder: number, ids: string[]) {
    await prisma.game.create({
      data: { sessionId, status: 'QUEUED', queueOrder, players: { create: ids.map((attendanceId, slot) => ({ attendanceId, slot })) } },
    });
  }

  it('맨 끝 조합(새 조합 바로 앞)에 든 사람은 빌리지 않고, 조합에 없는 게임 중 인원 → 먼 조합 순으로 빌린다', async () => {
    const session = await seedSession();
    const free = await Promise.all(Array.from({ length: 3 }, () => seedAttendance(session.id, 'MALE')));
    const far = await seedAttendance(session.id, 'MALE', 'MATCHED'); // 조합 1(새 조합까지 3칸)
    const mid = await seedAttendance(session.id, 'MALE', 'MATCHED'); // 조합 2(2칸)
    const last = await seedAttendance(session.id, 'MALE', 'MATCHED'); // 조합 3(1칸, 바로 앞)
    await seedQueued(session.id, 1, [far.id]);
    await seedQueued(session.id, 2, [mid.id]);
    await seedQueued(session.id, 3, [last.id]);

    // 조합에 든 사람만 있을 때 — 바로 앞은 빼고, 먼 조합(far)부터
    const onlyQueued = await service.recommend(session.id);
    const borrowedIds = new Set(onlyQueued.flatMap((r) => r.players.filter((p) => p.borrowedFrom !== null).map((p) => p.attendanceId)));
    expect(borrowedIds.has(last.id)).toBe(false);
    expect(onlyQueued[0].players.find((p) => p.borrowedFrom !== null)?.attendanceId).toBe(far.id);
    expect(onlyQueued[0].players.filter((p) => free.some((f) => f.id === p.attendanceId))).toHaveLength(3);

    // 조합에 없는 게임 중 인원이 있으면 그 사람이 가장 먼저
    const playing = await seedAttendance(session.id, 'MALE', 'PLAYING');
    const withPlaying = await service.recommend(session.id);
    expect(withPlaying[0].players.find((p) => p.borrowedFrom !== null)?.attendanceId).toBe(playing.id);
  });

  it('빌릴 수 있는 사람이 바로 앞 조합에만 있으면 추천하지 않는다', async () => {
    const session = await seedSession();
    await Promise.all(Array.from({ length: 3 }, () => seedAttendance(session.id, 'MALE')));
    const queued = await Promise.all(Array.from({ length: 4 }, () => seedAttendance(session.id, 'MALE', 'MATCHED')));
    await seedQueued(session.id, 1, queued.map((a) => a.id));
    expect(await service.recommend(session.id)).toEqual([]);
  });
});

describe('recommend — 지정 인원(fixedIds)', () => {
  it('지정한 사람은 모든 후보에 들어가고 pinned로 표시, 나머지 자리만 채운다', async () => {
    const session = await seedSession();
    const [a, b] = await Promise.all([seedAttendance(session.id, 'MALE'), seedAttendance(session.id, 'MALE')]);
    await Promise.all(Array.from({ length: 5 }, () => seedAttendance(session.id, 'MALE')));

    const results = await service.recommend(session.id, 'MENS', [a.id, b.id]);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const ids = r.players.map((p) => p.attendanceId);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(r.players.filter((p) => p.pinned).map((p) => p.attendanceId).sort()).toEqual([a.id, b.id].sort());
    }
  });

  it('4명을 다 지정하면 그대로 한 후보', async () => {
    const session = await seedSession();
    const four = await Promise.all(Array.from({ length: 4 }, () => seedAttendance(session.id, 'MALE')));
    await seedAttendance(session.id, 'MALE');

    const results = await service.recommend(session.id, 'ALL', four.map((x) => x.id));

    expect(results).toHaveLength(1);
    expect(results[0].players.map((p) => p.attendanceId).sort()).toEqual(four.map((x) => x.id).sort());
  });

  it('혼복에서 남성 1명 지정 — 남녀 2:2를 맞춘다', async () => {
    const session = await seedSession();
    const man = await seedAttendance(session.id, 'MALE');
    await Promise.all([
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'MALE'),
      seedAttendance(session.id, 'FEMALE'),
      seedAttendance(session.id, 'FEMALE'),
    ]);

    const results = await service.recommend(session.id, 'MIXED', [man.id]);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(composition(r.players)).toEqual({ m: 2, f: 2, u: 0 });
  });

  it('종목과 성별이 맞지 않으면 409(이름 포함), 혼복에 같은 성별 3명이면 409', async () => {
    const session = await seedSession();
    const woman = await seedAttendance(session.id, 'FEMALE');
    const men = await Promise.all(Array.from({ length: 3 }, () => seedAttendance(session.id, 'MALE')));
    await Promise.all(Array.from({ length: 3 }, () => seedAttendance(session.id, 'FEMALE')));

    await expect(service.recommend(session.id, 'MENS', [woman.id])).rejects.toThrow(woman.member.name);
    await expect(service.recommend(session.id, 'MIXED', men.map((m) => m.id))).rejects.toThrow(ConflictException);
  });

  it('휴식 중·이 모임에 없는 사람은 409, 같은 사람 중복은 400, 남은 인원 부족은 409', async () => {
    const session = await seedSession();
    const resting = await seedAttendance(session.id, 'MALE');
    await prisma.attendance.update({ where: { id: resting.id }, data: { status: 'RESTING' } });
    const a = await seedAttendance(session.id, 'MALE');
    await seedAttendance(session.id, 'MALE');

    await expect(service.recommend(session.id, 'ALL', [resting.id])).rejects.toThrow('휴식 중');
    await expect(service.recommend(session.id, 'ALL', ['없는-id'])).rejects.toThrow(ConflictException);
    await expect(service.recommend(session.id, 'ALL', [a.id, a.id])).rejects.toThrow(BadRequestException);
    // 출석자가 a와 1명(+휴식 1명)뿐 — 4명을 채울 수 없다
    await expect(service.recommend(session.id, 'ALL', [a.id])).rejects.toThrow('4명을 채울 수 없어요');
  });
});

describe('recommend — 온 시간 대비 게임 수', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  it('늦게 온 사람(0게임)이 일찍 와서 제 속도로 친 사람보다 앞서지 않는다 — 대기 시간 순서가 우선', async () => {
    const session = await seedSession();
    // 일찍 온 4명: 60분 전 콕 확인, 3게임, 20분째 대기
    const early = await Promise.all(Array.from({ length: 4 }, () => seedAttendance(session.id, 'MALE')));
    for (const a of early) {
      await prisma.attendance.update({
        where: { id: a.id },
        data: { shuttleConfirmedAt: minutesAgo(60), waitingSince: minutesAgo(20), gamesPlayed: 3 },
      });
    }
    // 방금 온 1명: 0게임, 방금 콕 확인
    const late = await seedAttendance(session.id, 'MALE');
    await prisma.attendance.update({
      where: { id: late.id },
      data: { shuttleConfirmedAt: minutesAgo(1), waitingSince: minutesAgo(1), gamesPlayed: 0 },
    });

    const [first] = await service.recommend(session.id);

    expect(first.players.map((p) => p.attendanceId).sort()).toEqual(early.map((a) => a.id).sort());
  });

  it('같은 시각에 온 사람끼리는 덜 친 사람이 우선', async () => {
    const session = await seedSession();
    const people = await Promise.all(Array.from({ length: 5 }, () => seedAttendance(session.id, 'MALE')));
    for (const [i, a] of people.entries()) {
      await prisma.attendance.update({
        where: { id: a.id },
        // 모두 60분 전에 왔고 10분째 대기, 마지막 1명만 다른 사람보다 2게임 더 침
        data: { shuttleConfirmedAt: minutesAgo(60), waitingSince: minutesAgo(10), gamesPlayed: i === 4 ? 5 : 3 },
      });
    }

    const [first] = await service.recommend(session.id);

    expect(first.players.map((p) => p.attendanceId)).not.toContain(people[4].id);
  });
});

describe('대회 연습 파트너', () => {
  it('둘 다 비어 있으면 조금 덜 기다렸어도 같은 게임에 넣는 쪽이 공정성 1순위, 한 명이 게임 중이면 평소대로', async () => {
    const session = await seedSession();
    const others = [];
    for (let i = 0; i < 4; i++) others.push(await seedAttendance(session.id, 'MALE'));
    const a = await seedAttendance(session.id, 'MALE');
    const b = await seedAttendance(session.id, 'MALE');
    // 파트너 둘은 15분 덜 기다림 — 가점이 없으면 1순위는 오래 기다린 4명
    for (const row of [a, b]) {
      await prisma.attendance.update({
        where: { id: row.id },
        data: { waitingSince: new Date('2026-01-01T10:15:00Z') },
      });
    }
    await prisma.attendance.update({ where: { id: a.id }, data: { partnerAttendanceId: b.id } });
    await prisma.attendance.update({ where: { id: b.id }, data: { partnerAttendanceId: a.id } });

    const [top] = await service.recommend(session.id);
    const ids = top.players.map((p) => p.attendanceId);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));

    // 한 명이 게임 중이면 가점 없음 — 오래 기다린 4명 그대로
    await prisma.attendance.update({ where: { id: b.id }, data: { status: 'PLAYING' } });
    const [plain] = await service.recommend(session.id);
    expect(plain.players.map((p) => p.attendanceId).sort()).toEqual(others.map((o) => o.id).sort());
  });
});
