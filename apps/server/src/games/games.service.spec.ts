import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { GamesService } from './games.service';

// 게임 상태 머신 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다
// (조합 생성/배정/종료/대기로/해체/선수 교체가 출석 상태·카운터를 올바르게 전이시키는지)

// 브로드캐스트는 상태 전이와 무관 — 소켓 없이 서비스만 조립하기 위한 스텁
const realtimeStub = {
  broadcastSnapshot: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();
const sessionsService = new SessionsService(prisma, realtimeStub);
const service = new GamesService(prisma, sessionsService, realtimeStub);

// ===== 시드 헬퍼 =====

let seq = 0; // 회원 이름 중복 방지용 일련번호

async function seedSession() {
  return prisma.session.create({
    data: { date: new Date('2026-01-01'), checkInCode: 'TEST01' },
  });
}

async function seedCourt(sessionId: string, courtNo = 1) {
  return prisma.court.create({ data: { sessionId, courtNo } });
}

// 회원 생성 + 체크인 상태의 출석 1행 — 상태 전이의 기본 시작점
async function seedAttendance(
  sessionId: string,
  overrides: {
    status?: 'CHECKED_IN' | 'MATCHED' | 'PLAYING' | 'RESTING' | 'LEFT';
    waitingSince?: Date;
  } = {},
) {
  const member = await prisma.member.create({
    data: {
      name: `테스트${++seq}`,
      grade: 'C',
      gender: 'MALE',
      birthDate: new Date('2000-01-01'),
    },
  });
  return prisma.attendance.create({
    data: {
      sessionId,
      memberId: member.id,
      status: overrides.status ?? 'CHECKED_IN',
      waitingSince: overrides.waitingSince ?? new Date('2026-01-01T10:00:00Z'),
    },
  });
}

async function seedFour(sessionId: string) {
  return Promise.all([
    seedAttendance(sessionId),
    seedAttendance(sessionId),
    seedAttendance(sessionId),
    seedAttendance(sessionId),
  ]);
}

async function statusOf(attendanceId: string) {
  const row = await prisma.attendance.findUniqueOrThrow({ where: { id: attendanceId } });
  return row.status;
}

beforeEach(async () => {
  // 테스트 간 완전 격리 — FK 순서 무관하게 한 번에 비운다
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ===== create (조합 생성) =====

describe('create', () => {
  it('CHECKED_IN 4명 → QUEUED 게임 + 전원 MATCHED 승격, 큐 맨 뒤에 붙는다', async () => {
    const session = await seedSession();
    const [a, b, c, d] = await seedFour(session.id);

    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });

    expect(game.status).toBe('QUEUED');
    expect(game.queueOrder).toBe(1);
    for (const att of [a, b, c, d]) {
      expect(await statusOf(att.id)).toBe('MATCHED');
    }

    // 두 번째 조합은 큐 맨 뒤(queueOrder 2)
    const [e, f, g, h] = await seedFour(session.id);
    const second = await service.create(session.id, {
      attendanceIds: [e.id, f.id, g.id, h.id],
    });
    expect(second.queueOrder).toBe(2);
  });

  it('휴식(RESTING) 인원이 포함되면 409 — 조합 투입 차단', async () => {
    const session = await seedSession();
    const resting = await seedAttendance(session.id, { status: 'RESTING' });
    const [a, b, c] = await seedFour(session.id);

    await expect(
      service.create(session.id, { attendanceIds: [resting.id, a.id, b.id, c.id] }),
    ).rejects.toThrow('퇴장·휴식 중이거나 이 모임에 없는 모임원이 포함되어 있습니다.');
  });

  it('중복 대기 — PLAYING·MATCHED 인원도 조합에 넣을 수 있고 상태는 유지된다', async () => {
    const session = await seedSession();
    const playing = await seedAttendance(session.id, { status: 'PLAYING' });
    const matched = await seedAttendance(session.id, { status: 'MATCHED' });
    const [a, b] = await seedFour(session.id);

    await service.create(session.id, {
      attendanceIds: [playing.id, matched.id, a.id, b.id],
    });

    expect(await statusOf(playing.id)).toBe('PLAYING'); // 게임 중은 건드리지 않음
    expect(await statusOf(matched.id)).toBe('MATCHED');
    expect(await statusOf(a.id)).toBe('MATCHED'); // 미배정만 승격
  });

  it('LEFT 인원 포함 시 409, 같은 사람 중복 선택 시 400', async () => {
    const session = await seedSession();
    const left = await seedAttendance(session.id, { status: 'LEFT' });
    const [a, b, c] = await seedFour(session.id);

    await expect(
      service.create(session.id, { attendanceIds: [left.id, a.id, b.id, c.id] }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.create(session.id, { attendanceIds: [a.id, a.id, b.id, c.id] }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ===== assign (코트 배정) =====

describe('assign', () => {
  it('QUEUED → PLAYING: 코트 IN_GAME, 전원 PLAYING, startedAt 기록, queueOrder 제거', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });

    const assigned = await service.assign(game.id, { courtId: court.id });

    expect(assigned.status).toBe('PLAYING');
    expect(assigned.startedAt).not.toBeNull();
    expect(assigned.queueOrder).toBeNull();
    for (const att of [a, b, c, d]) {
      expect(await statusOf(att.id)).toBe('PLAYING');
    }
    const courtAfter = await prisma.court.findUniqueOrThrow({ where: { id: court.id } });
    expect(courtAfter.status).toBe('IN_GAME');
  });

  it('조합에 다른 코트에서 게임 중인 사람이 있으면 배정 불가(409)', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const busy = await seedAttendance(session.id, { status: 'PLAYING' });
    const [a, b, c] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [busy.id, a.id, b.id, c.id],
    });

    await expect(service.assign(game.id, { courtId: court.id })).rejects.toThrow(
      ConflictException,
    );
  });

  it('이미 게임이 진행 중인 코트에는 배정 불가(409)', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const first = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    await service.assign(first.id, { courtId: court.id });

    const [e, f, g, h] = await seedFour(session.id);
    const second = await service.create(session.id, {
      attendanceIds: [e.id, f.id, g.id, h.id],
    });
    await expect(service.assign(second.id, { courtId: court.id })).rejects.toThrow(
      ConflictException,
    );
  });
});

// ===== finish (게임 종료) =====

describe('finish', () => {
  it('전원 게임 수 +1 · 대기시간 리셋 · CHECKED_IN 복귀, 코트 IDLE', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    await service.assign(game.id, { courtId: court.id });

    const finished = await service.finish(game.id);

    expect(finished.status).toBe('FINISHED');
    for (const att of [a, b, c, d]) {
      const row = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
      expect(row.status).toBe('CHECKED_IN');
      expect(row.gamesPlayed).toBe(1);
      expect(row.waitingSince.getTime()).toBeGreaterThan(att.waitingSince.getTime()); // 대기 리셋
    }
    const courtAfter = await prisma.court.findUniqueOrThrow({ where: { id: court.id } });
    expect(courtAfter.status).toBe('IDLE');
  });

  it('중복 대기 — 다른 QUEUED 조합에 남아 있는 사람은 CHECKED_IN이 아니라 MATCHED로', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    await service.assign(game.id, { courtId: court.id });
    // a는 다음 게임 조합에도 미리 들어가 있다 (겹침)
    const [e, f, g] = await seedFour(session.id);
    await service.create(session.id, { attendanceIds: [a.id, e.id, f.id, g.id] });

    await service.finish(game.id);

    expect(await statusOf(a.id)).toBe('MATCHED'); // 남은 조합 유지
    expect(await statusOf(b.id)).toBe('CHECKED_IN'); // 완전히 자유
  });
});

// ===== unassign (대기로) =====

describe('unassign', () => {
  it('조합 유지한 채 큐 맨 뒤로 — 전원 MATCHED, startedAt 초기화, 코트 IDLE, 게임 수 미집계', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    await service.assign(game.id, { courtId: court.id });
    // 큐에 다른 조합이 하나 있는 상태에서 되돌리면 그 뒤(queueOrder 2)로 가야 한다
    const [e, f, g, h] = await seedFour(session.id);
    await service.create(session.id, { attendanceIds: [e.id, f.id, g.id, h.id] });

    const unassigned = await service.unassign(game.id);

    expect(unassigned.status).toBe('QUEUED');
    expect(unassigned.startedAt).toBeNull();
    expect(unassigned.queueOrder).toBe(2);
    for (const att of [a, b, c, d]) {
      const row = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
      expect(row.status).toBe('MATCHED');
      expect(row.gamesPlayed).toBe(0);
    }
    const courtAfter = await prisma.court.findUniqueOrThrow({ where: { id: court.id } });
    expect(courtAfter.status).toBe('IDLE');
  });
});

// ===== cancel (취소·해체) =====

describe('cancel', () => {
  it('PLAYING 게임 취소 — 게임 수 미집계 · 대기시간 보존 · CHECKED_IN 복귀, 코트 IDLE', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    await service.assign(game.id, { courtId: court.id });

    const canceled = await service.cancel(game.id);

    expect(canceled.status).toBe('CANCELED');
    for (const att of [a, b, c, d]) {
      const row = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
      expect(row.status).toBe('CHECKED_IN');
      expect(row.gamesPlayed).toBe(0); // finish와 달리 미집계
      expect(row.waitingSince.getTime()).toBe(att.waitingSince.getTime()); // 대기시간 보존
    }
    const courtAfter = await prisma.court.findUniqueOrThrow({ where: { id: court.id } });
    expect(courtAfter.status).toBe('IDLE');
  });

  it('겹침 해체 — 두 조합에 든 사람은 하나를 해체해도 MATCHED 유지, 게임 중인 사람은 PLAYING 유지', async () => {
    const session = await seedSession();
    // busy는 실제로 다른 코트에서 게임 중 — cancel의 상태 재계산은 출석 상태가 아니라
    // 실제 게임 참여 기록을 근거로 하므로, 진짜 PLAYING 게임을 만들어야 한다
    const court = await seedCourt(session.id);
    const [busy, p2, p3, p4] = await seedFour(session.id);
    const playingGame = await service.create(session.id, {
      attendanceIds: [busy.id, p2.id, p3.id, p4.id],
    });
    await service.assign(playingGame.id, { courtId: court.id });
    const [a, b, c] = await seedFour(session.id);
    const target = await service.create(session.id, {
      attendanceIds: [busy.id, a.id, b.id, c.id],
    });
    // a는 다른 조합에도 들어 있다
    const [e, f, g] = await seedFour(session.id);
    await service.create(session.id, { attendanceIds: [a.id, e.id, f.id, g.id] });

    await service.cancel(target.id);

    expect(await statusOf(busy.id)).toBe('PLAYING'); // 다른 코트 게임은 무관
    expect(await statusOf(a.id)).toBe('MATCHED'); // 남은 조합 유지
    expect(await statusOf(b.id)).toBe('CHECKED_IN'); // 완전히 자유
  });
});

// ===== replacePlayer (선수 교체) =====

describe('replacePlayer', () => {
  it('PLAYING 게임 교체 — out은 CHECKED_IN 복귀(대기시간 보존), in은 PLAYING, 타이머 유지', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    const assigned = await service.assign(game.id, { courtId: court.id });
    const incoming = await seedAttendance(session.id);

    const replaced = await service.replacePlayer(game.id, {
      outAttendanceId: a.id,
      inAttendanceId: incoming.id,
    });

    expect(replaced.startedAt).toEqual(assigned.startedAt); // 게임을 갈아엎지 않음
    const names = (replaced.players ?? []).map((p) => p.attendanceId);
    expect(names).not.toContain(a.id);
    expect(names).toContain(incoming.id);
    const outRow = await prisma.attendance.findUniqueOrThrow({ where: { id: a.id } });
    expect(outRow.status).toBe('CHECKED_IN');
    expect(outRow.waitingSince.getTime()).toBe(a.waitingSince.getTime()); // 대기시간 보존
    expect(await statusOf(incoming.id)).toBe('PLAYING');
  });

  it('PLAYING 게임엔 다른 코트에서 게임 중인 사람 투입 불가(409)', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id);
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    await service.assign(game.id, { courtId: court.id });
    const busy = await seedAttendance(session.id, { status: 'PLAYING' });

    await expect(
      service.replacePlayer(game.id, { outAttendanceId: a.id, inAttendanceId: busy.id }),
    ).rejects.toThrow(ConflictException);
  });

  it('QUEUED 조합 교체 — 게임 중인 사람 투입 허용(PLAYING 유지), out은 CHECKED_IN·in CHECKED_IN은 MATCHED', async () => {
    const session = await seedSession();
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    const busy = await seedAttendance(session.id, { status: 'PLAYING' });

    // 게임 중인 사람을 QUEUED 조합에 투입 — 중복 대기 정책상 허용
    await service.replacePlayer(game.id, {
      outAttendanceId: a.id,
      inAttendanceId: busy.id,
    });
    expect(await statusOf(busy.id)).toBe('PLAYING'); // 상태 유지
    expect(await statusOf(a.id)).toBe('CHECKED_IN'); // 다른 조합 없으므로 대기 복귀

    // 미배정 대기자를 투입하면 MATCHED로 승격
    const waiting = await seedAttendance(session.id);
    await service.replacePlayer(game.id, {
      outAttendanceId: b.id,
      inAttendanceId: waiting.id,
    });
    expect(await statusOf(waiting.id)).toBe('MATCHED');
  });

  it('가드 — 게임에 없는 out(409), 이미 게임에 있는 in(409), 같은 사람(400), LEFT 투입(409)', async () => {
    const session = await seedSession();
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    const outsider = await seedAttendance(session.id);
    const left = await seedAttendance(session.id, { status: 'LEFT' });

    await expect(
      service.replacePlayer(game.id, { outAttendanceId: outsider.id, inAttendanceId: a.id }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.replacePlayer(game.id, { outAttendanceId: a.id, inAttendanceId: b.id }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.replacePlayer(game.id, { outAttendanceId: a.id, inAttendanceId: a.id }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.replacePlayer(game.id, { outAttendanceId: a.id, inAttendanceId: left.id }),
    ).rejects.toThrow(ConflictException);
  });

  it('겹침 out — 다른 QUEUED 조합에 남아 있는 사람이 빠지면 CHECKED_IN이 아니라 MATCHED로', async () => {
    const session = await seedSession();
    const [a, b, c, d] = await seedFour(session.id);
    const game = await service.create(session.id, {
      attendanceIds: [a.id, b.id, c.id, d.id],
    });
    // a는 다른 조합에도 들어 있다
    const [e, f, g] = await seedFour(session.id);
    await service.create(session.id, { attendanceIds: [a.id, e.id, f.id, g.id] });
    const incoming = await seedAttendance(session.id);

    await service.replacePlayer(game.id, {
      outAttendanceId: a.id,
      inAttendanceId: incoming.id,
    });

    expect(await statusOf(a.id)).toBe('MATCHED'); // 남은 조합 기준으로 재계산
  });
});
