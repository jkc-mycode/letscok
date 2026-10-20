import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from './sessions.service';

// 체크인 코드 변경·승계 통합 테스트 — 운영진이 정한 코드가 모임마다 초기화되지 않아야 한다

const realtimeStub = {
  broadcastSnapshot: () => undefined,
  broadcastSessionClosed: () => undefined,
  broadcastOpenSessions: async () => undefined,
  buildSnapshot: async (id: string) => ({ session: { id } }), // 어느 모임을 골랐는지만 본다
} as unknown as RealtimeService;

const prisma = new PrismaService();

// 동시 요청 시험 전에 DB 연결을 여러 개 미리 열어 둔다 — 안 그러면 두 번째 요청이 새 연결을 맺는 사이 첫 요청이 끝나 경쟁이 재현되지 않는다
const warmPool = () => Promise.all(Array.from({ length: 4 }, () => prisma.$executeRaw`SELECT pg_sleep(0.05)`));
const service = new SessionsService(prisma, realtimeStub);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('updateCheckInCode', () => {
  it('진행 중 모임의 코드를 바꾼다 — 0000처럼 단순한 값도 허용', async () => {
    await service.open();

    const updated = await service.updateCheckInCode('0000');

    expect(updated).toBe('0000');
    expect(await service.getCurrentCheckInCode()).toBe('0000');
  });

  it('진행 중 모임이 없으면 404', async () => {
    await expect(service.updateCheckInCode('1234')).rejects.toThrow(NotFoundException);
  });
});

describe('open — 코드 승계', () => {
  it('새 모임은 직전 모임의 코드를 이어받는다 (공지 월일 코드를 매번 다시 정하지 않도록)', async () => {
    const first = await service.open();
    await service.updateCheckInCode('1234');
    await service.close(first.id);
    // 같은 날 재개가 아니라 새 날짜의 모임이어야 승계 경로를 탄다
    await prisma.session.update({
      where: { id: first.id },
      data: { date: new Date('2020-01-01') },
    });

    const second = await service.open();

    expect(second.id).not.toBe(first.id);
    expect(await service.getCurrentCheckInCode()).toBe('1234');
  });

  it('직전 모임이 없으면 새로 발급한다', async () => {
    await service.open();

    const code = await service.getCurrentCheckInCode();
    expect(code).toMatch(/^[A-Z0-9]{4,8}$/);
  });
});

describe('open — 같은 날 여러 모임', () => {
  it('기본은 같은 날 종료한 모임을 다시 연다 (실수 종료 복구)', async () => {
    const first = await service.open();
    await service.close(first.id);

    const again = await service.open();

    expect(again.id).toBe(first.id);
    expect(again.status).toBe('OPEN');
  });

  it('fresh면 같은 날이어도 새 모임을 만들고 코드는 이어받는다', async () => {
    const first = await service.open();
    await service.updateCheckInCode('1017');
    await service.close(first.id);

    const second = await service.open(true);

    expect(second.id).not.toBe(first.id);
    expect(second.date).toBe(first.date);
    expect(await service.getCurrentCheckInCode()).toBe('1017');
  });

  it('같은 날 두 모임이 종료돼 있으면 마지막에 끝난 모임을 다시 연다', async () => {
    const first = await service.open();
    await service.close(first.id);
    const second = await service.open(true);
    await service.close(second.id);

    const again = await service.open();

    expect(again.id).toBe(second.id);
  });
});

describe('getClosedToday', () => {
  it('오늘 종료한 모임이 없으면 빈 목록', async () => {
    expect((await service.getClosedToday()).sessions).toEqual([]);
    await service.open();
    expect((await service.getClosedToday()).sessions).toEqual([]); // 진행 중은 해당 없음
  });

  it('오늘 종료한 모임을 늦게 끝난 순으로, 출석 인원·이름과 함께 준다', async () => {
    const first = await service.open();
    const member = await prisma.member.create({ data: { name: '김민수', grade: 'C' } });
    await prisma.attendance.create({ data: { sessionId: first.id, memberId: member.id } });
    const men = await service.open(false, '남복');
    await service.close(first.id);
    await service.close(men.id);

    const closed = await service.getClosedToday();

    expect(closed.sessions.map((c) => c.session.id)).toEqual([men.id, first.id]);
    expect(closed.sessions.map((c) => c.attendeeCount)).toEqual([0, 1]);
    expect(closed.sessions[0].session.label).toBe('남복');
    expect(closed.sessionCountToday).toBe(2);
  });

  it('어제 종료한 모임은 해당 없음', async () => {
    const first = await service.open();
    await service.close(first.id);
    await prisma.session.update({ where: { id: first.id }, data: { date: new Date('2020-01-01') } });

    expect((await service.getClosedToday()).sessions).toEqual([]);
  });
});

describe('open — 끝낸 모임 골라 다시 열기', () => {
  it('두 모임이 끝났으면 먼저 끝난 쪽도 골라 되살린다', async () => {
    const women = await service.open(false, '여복');
    const men = await service.open(false, '남복');
    await service.close(women.id); // 실수로 끝낸 쪽
    await service.close(men.id);

    const again = await service.open(false, undefined, women.id);

    expect(again.id).toBe(women.id);
    expect(again.status).toBe('OPEN');
    expect(await prisma.session.count()).toBe(2);
  });

  it('다른 모임이 열려 있어도 끝낸 모임을 되살린다', async () => {
    const women = await service.open(false, '여복');
    await service.open(false, '남복');
    await service.close(women.id);

    const again = await service.open(false, undefined, women.id);

    expect(again.id).toBe(women.id);
    expect(again.label).toBe('여복');
    expect(await prisma.session.count({ where: { status: 'OPEN' } })).toBe(2);
  });

  it('이름 없는 모임을 같이 되살리려면 이름을 정해야 하고, 정하면 그 이름으로', async () => {
    const first = await service.open();
    await service.close(first.id);
    await service.open(true, '남복');

    await expect(service.open(false, undefined, first.id)).rejects.toThrow(ConflictException);
    await expect(service.open(false, '남복', first.id)).rejects.toThrow(ConflictException);
    const again = await service.open(false, '여복', first.id);

    expect(again.id).toBe(first.id);
    expect(again.label).toBe('여복');
  });

  it('열린 모임·어제 모임은 되살리지 않는다', async () => {
    const open = await service.open();
    await expect(service.open(false, undefined, open.id)).rejects.toThrow(NotFoundException);

    await service.close(open.id);
    await prisma.session.update({ where: { id: open.id }, data: { date: new Date('2020-01-01') } });
    await expect(service.open(false, undefined, open.id)).rejects.toThrow(NotFoundException);
  });
});

describe('동시에 여는 모임 (여복·남복)', () => {
  it('열린 모임이 있으면 이름 없이는 열 수 없다 (실수로 두 번 누른 것 대비)', async () => {
    await service.open();

    await expect(service.open()).rejects.toThrow(ConflictException);
  });

  it('[모임 시작]을 동시에 두 번 눌러도 모임은 하나만 열린다', async () => {
    await warmPool();
    const results = await Promise.allSettled([service.open(), service.open()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')?.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.session.count({ where: { status: 'OPEN' } })).toBe(1);
  });

  it('이름을 정하면 같이 열고, 체크인 코드는 같다', async () => {
    const first = await service.open();
    await service.updateCheckInCode('1019');

    const second = await service.open(false, ' 남복 ');

    expect(second.id).not.toBe(first.id);
    expect(second.label).toBe('남복');
    expect(await prisma.session.count({ where: { status: 'OPEN' } })).toBe(2);
    const codes = await prisma.session.findMany({ select: { checkInCode: true } });
    expect(codes.every((c) => c.checkInCode === '1019')).toBe(true);
  });

  it('열린 모임과 같은 이름은 막는다', async () => {
    await service.open(false, '여복');

    await expect(service.open(false, '여복')).rejects.toThrow(ConflictException);
  });

  it('같이 열 땐 오늘 끝낸 모임을 되살리지 않고 새로 만든다', async () => {
    const morning = await service.open();
    await service.close(morning.id);
    await service.open();
    const reopenedCount = await prisma.session.count();

    const other = await service.open(false, '남복');

    expect(other.id).not.toBe(morning.id);
    expect(await prisma.session.count()).toBe(reopenedCount + 1);
  });

  it('코드를 바꾸면 열린 모임 전부에 적용된다', async () => {
    await service.open(false, '여복');
    await service.open(false, '남복');

    await service.updateCheckInCode('1234');

    const open = await prisma.session.findMany({ where: { status: 'OPEN' }, select: { checkInCode: true } });
    expect(open.map((s) => s.checkInCode)).toEqual(['1234', '1234']);
  });
});

describe('updateLabel', () => {
  it('이름을 바꾸고, 빈 값이면 지운다', async () => {
    const session = await service.open();

    expect((await service.updateLabel(session.id, '여복')).label).toBe('여복');
    expect((await service.updateLabel(session.id, '  ')).label).toBeNull();
  });

  it('다른 열린 모임과 같은 이름은 막는다', async () => {
    const first = await service.open();
    await service.open(false, '남복');

    await expect(service.updateLabel(first.id, '남복')).rejects.toThrow(ConflictException);
  });

  it('끝난 모임은 404', async () => {
    const session = await service.open();
    await service.close(session.id);

    await expect(service.updateLabel(session.id, '여복')).rejects.toThrow(NotFoundException);
  });
});

describe('getCurrentSnapshot — 어느 모임을 줄지', () => {
  const pick = async (prefer?: { id?: string; memberId?: string }) =>
    (await service.getCurrentSnapshot(prefer)).session.id;

  it('고른 모임 → 내가 출석한 모임 → 먼저 연 모임 순으로 고른다', async () => {
    const women = await service.open(false, '여복');
    const men = await service.open(false, '남복');
    const member = await prisma.member.create({ data: { name: '김민수', grade: 'C' } });
    await prisma.attendance.create({ data: { sessionId: men.id, memberId: member.id } });

    expect(await pick()).toBe(women.id); // 옛 화면은 먼저 연 모임
    expect(await pick({ id: men.id })).toBe(men.id);
    expect(await pick({ memberId: member.id })).toBe(men.id);
    expect(await pick({ id: 'closed-or-unknown' })).toBe(women.id); // 끝난 모임을 기억하고 있어도 열린 모임으로
  });

  it('퇴장한 모임은 내 모임으로 치지 않는다', async () => {
    const women = await service.open(false, '여복');
    const men = await service.open(false, '남복');
    const member = await prisma.member.create({ data: { name: '이영희', grade: 'C' } });
    await prisma.attendance.create({ data: { sessionId: men.id, memberId: member.id, status: 'LEFT' } });

    expect(await pick({ memberId: member.id })).toBe(women.id);
  });

  it('열린 모임이 없으면 404', async () => {
    await expect(service.getCurrentSnapshot()).rejects.toThrow(NotFoundException);
  });
});
