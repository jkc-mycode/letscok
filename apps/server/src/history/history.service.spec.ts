import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HistoryService } from './history.service';

// 히스토리 집계 통합 테스트 — 실제 Prisma+테스트 DB로 목록/상세/개인 전적의 계산 정확성을 검증

const prisma = new PrismaService();
const service = new HistoryService(prisma);

let seq = 0;

async function seedMember(name?: string) {
  return prisma.member.create({
    data: {
      name: name ?? `기록${++seq}`,
      grade: 'C',
      gender: 'MALE',
      birthDate: new Date('2000-01-01'),
    },
  });
}

async function seedClosedSession(date: string) {
  return prisma.session.create({
    data: { date: new Date(date), status: 'CLOSED', closedAt: new Date() },
  });
}

async function seedAttendance(
  sessionId: string,
  memberId: string,
  gamesPlayed = 0,
  status: 'CHECKED_IN' | 'LEFT' = 'CHECKED_IN',
) {
  return prisma.attendance.create({
    data: { sessionId, memberId, gamesPlayed, status },
  });
}

// 완료된 게임을 결과 상태 그대로 심는다 (상태 전이는 games.service.spec.ts가 검증하므로 여기선 최종형만 필요)
async function seedFinishedGame(sessionId: string, attendanceIds: string[], courtId?: string) {
  return prisma.game.create({
    data: {
      sessionId,
      courtId,
      status: 'FINISHED',
      startedAt: new Date('2026-01-01T11:00:00Z'),
      endedAt: new Date('2026-01-01T11:20:00Z'),
      players: { createMany: { data: attendanceIds.map((attendanceId) => ({ attendanceId })) } },
    },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('listSessions', () => {
  it('CLOSED 세션만 최신순으로, 출석·완료 게임 수를 집계한다 (CANCELED 제외)', async () => {
    const old = await seedClosedSession('2026-01-01');
    const recent = await seedClosedSession('2026-01-08');
    await prisma.session.create({ data: { date: new Date('2026-01-15') } }); // OPEN — 목록 제외

    const [m1, m2, m3, m4] = await Promise.all([
      seedMember(), seedMember(), seedMember(), seedMember(),
    ]);
    const atts = await Promise.all(
      [m1, m2, m3, m4].map((m) => seedAttendance(recent.id, m.id, 1)),
    );
    await seedFinishedGame(recent.id, atts.map((a) => a.id));
    // CANCELED는 집계에서 빠져야 한다
    await prisma.game.create({
      data: { sessionId: recent.id, status: 'CANCELED' },
    });

    const result = await service.listSessions(1, 20);

    expect(result.total).toBe(2); // OPEN 제외
    expect(result.sessions.map((s) => s.id)).toEqual([recent.id, old.id]); // 최신순
    expect(result.sessions[0]).toMatchObject({ attendeeCount: 4, finishedGameCount: 1 });
    expect(result.sessions[1]).toMatchObject({ attendeeCount: 0, finishedGameCount: 0 });
  });

  it('페이지네이션 — skip/take가 적용된다', async () => {
    await seedClosedSession('2026-01-01');
    await seedClosedSession('2026-01-08');
    await seedClosedSession('2026-01-15');

    const page2 = await service.listSessions(2, 2);
    expect(page2.total).toBe(3);
    expect(page2.sessions).toHaveLength(1);
    expect(page2.sessions[0].date).toBe('2026-01-01'); // 최신순 3번째
  });
});

describe('getSessionDetail', () => {
  it('출석자는 그날 많이 뛴 순(LEFT 포함), 게임은 FINISHED만 4인 이름과 함께', async () => {
    const session = await seedClosedSession('2026-01-01');
    const court = await prisma.court.create({
      data: { sessionId: session.id, courtNo: 3, deletedAt: new Date() }, // 해제된 코트여도 번호 표시
    });
    const [m1, m2, m3, m4, m5] = await Promise.all([
      seedMember('가'), seedMember('나'), seedMember('다'), seedMember('라'), seedMember('마'),
    ]);
    const a1 = await seedAttendance(session.id, m1.id, 2);
    const a2 = await seedAttendance(session.id, m2.id, 1);
    const a3 = await seedAttendance(session.id, m3.id, 1);
    const a4 = await seedAttendance(session.id, m4.id, 1);
    await seedAttendance(session.id, m5.id, 0, 'LEFT'); // 일찍 간 사람도 출석자
    await seedFinishedGame(session.id, [a1.id, a2.id, a3.id, a4.id], court.id);

    const detail = await service.getSessionDetail(session.id);

    expect(detail.session.attendeeCount).toBe(5);
    expect(detail.attendees[0].name).toBe('가'); // 2게임 — 맨 위
    expect(detail.attendees.map((a) => a.name)).toContain('마'); // LEFT 포함
    expect(detail.games).toHaveLength(1);
    expect(detail.games[0].courtNo).toBe(3); // soft-delete 코트 번호 유지
    expect(detail.games[0].players.map((p) => p.name).sort()).toEqual(['가', '나', '다', '라']);
    expect(detail.games[0].players.every((p) => p.grade)).toBe(true); // 동명이인 구분용 급수 포함
  });

  it('없는 세션은 404', async () => {
    await expect(service.getSessionDetail('none')).rejects.toThrow(NotFoundException);
  });
});

describe('getRanking', () => {
  it('출석순 → 게임순 → 이름순으로 정렬하고, 0회 멤버도 맨 아래 포함한다', async () => {
    const s1 = await seedClosedSession('2026-01-01');
    const s2 = await seedClosedSession('2026-01-08');
    const many = await seedMember('다출석'); // 2회 출석
    const someA = await seedMember('나게임'); // 1회 출석, 3게임 — 동률(출석 1회)에서 게임순 위
    const someB = await seedMember('가게임'); // 1회 출석, 1게임
    const zero = await seedMember('안나옴'); // 0회 — 맨 아래
    await seedAttendance(s1.id, many.id, 1);
    await seedAttendance(s2.id, many.id, 2);
    await seedAttendance(s1.id, someA.id, 3);
    await seedAttendance(s1.id, someB.id, 1);

    const ranking = await service.getRanking();

    expect(ranking.map((r) => r.name)).toEqual(['다출석', '나게임', '가게임', '안나옴']);
    expect(ranking[0]).toMatchObject({
      totalSessions: 2,
      totalGames: 3,
      lastAttendedDate: '2026-01-08',
    });
    expect(ranking[3]).toMatchObject({
      totalSessions: 0,
      totalGames: 0,
      lastAttendedDate: null,
    });
  });

  it('삭제된 회원은 랭킹에서 빠진다 (지난 모임 상세는 attendance 경유라 영향 없음)', async () => {
    const session = await seedClosedSession('2026-01-01');
    const stay = await seedMember('가잔류');
    const gone = await seedMember('나삭제');
    await seedAttendance(session.id, stay.id, 1);
    await seedAttendance(session.id, gone.id, 1);
    await prisma.member.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const ranking = await service.getRanking();
    expect(ranking.map((r) => r.name)).toEqual(['가잔류']);
  });

  it('완전 동률은 이름 가나다순으로 안정 정렬한다', async () => {
    const session = await seedClosedSession('2026-01-01');
    const b = await seedMember('나다라');
    const a = await seedMember('가나다');
    await seedAttendance(session.id, b.id, 1);
    await seedAttendance(session.id, a.id, 1);

    const ranking = await service.getRanking();
    expect(ranking.map((r) => r.name)).toEqual(['가나다', '나다라']);
  });

  it('months 지정 시 기간 밖 출석은 집계에서 빠진다', async () => {
    // 오래된 모임(4개월 전)과 최근 모임(어제) — 1개월 필터면 최근 것만 잡혀야 한다
    const old = new Date();
    old.setMonth(old.getMonth() - 4);
    const recent = new Date();
    recent.setDate(recent.getDate() - 1);
    const oldSession = await seedClosedSession(old.toISOString().slice(0, 10));
    const recentSession = await seedClosedSession(recent.toISOString().slice(0, 10));

    const veteran = await seedMember('옛날사람'); // 옛 모임만 출석
    const active = await seedMember('요즘사람'); // 최근 모임만 출석
    await seedAttendance(oldSession.id, veteran.id, 2);
    await seedAttendance(recentSession.id, active.id, 1);

    const all = await service.getRanking();
    expect(all.find((r) => r.name === '옛날사람')?.totalSessions).toBe(1); // 전체 누적엔 포함

    const lastMonth = await service.getRanking(1);
    expect(lastMonth.find((r) => r.name === '요즘사람')?.totalSessions).toBe(1);
    expect(lastMonth.find((r) => r.name === '옛날사람')).toMatchObject({
      totalSessions: 0, // 기간 밖 — 0회로 강등되지만 목록엔 남는다 (멤버 색인)
      lastAttendedDate: null,
    });
  });
});

describe('getMemberStats', () => {
  it('누적 출석·게임·최근 출석일·파트너 top·최근 모임 목록을 집계한다', async () => {
    const s1 = await seedClosedSession('2026-01-01');
    const s2 = await seedClosedSession('2026-01-08');
    const me = await seedMember('본인');
    const friend = await seedMember('단짝');
    const [m3, m4] = await Promise.all([seedMember(), seedMember()]);

    // 1주차: 본인+단짝 같은 게임 1판
    const w1 = await Promise.all([
      seedAttendance(s1.id, me.id, 1),
      seedAttendance(s1.id, friend.id, 1),
      seedAttendance(s1.id, m3.id, 1),
      seedAttendance(s1.id, m4.id, 1),
    ]);
    await seedFinishedGame(s1.id, w1.map((a) => a.id));
    // 2주차: 단짝과는 또 같은 게임, 나머지 둘은 새 얼굴 — 단짝만 2회가 되도록
    const [m5, m6] = await Promise.all([seedMember(), seedMember()]);
    const w2 = await Promise.all([
      seedAttendance(s2.id, me.id, 1),
      seedAttendance(s2.id, friend.id, 1),
      seedAttendance(s2.id, m5.id, 1),
      seedAttendance(s2.id, m6.id, 1),
    ]);
    await seedFinishedGame(s2.id, w2.map((a) => a.id));

    const stats = await service.getMemberStats(me.id);

    expect(stats.totalSessions).toBe(2);
    expect(stats.totalGames).toBe(2);
    expect(stats.lastAttendedDate).toBe('2026-01-08');
    expect(stats.topPartners).toHaveLength(5); // 본인 제외 5명
    expect(stats.topPartners[0]).toMatchObject({ name: '단짝', gamesTogether: 2 });
    expect(stats.recentSessions.map((r) => r.date)).toEqual(['2026-01-08', '2026-01-01']);
  });

  it('없는 모임원은 404, 게임 이력 없는 모임원은 빈 통계', async () => {
    await expect(service.getMemberStats('none')).rejects.toThrow(NotFoundException);

    const newbie = await seedMember('새싹');
    const stats = await service.getMemberStats(newbie.id);
    expect(stats).toMatchObject({
      totalSessions: 0,
      totalGames: 0,
      lastAttendedDate: null,
      topPartners: [],
      recentSessions: [],
    });
  });
});
