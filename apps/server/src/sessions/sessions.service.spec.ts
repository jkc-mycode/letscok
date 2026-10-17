import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from './sessions.service';

// 체크인 코드 변경·승계 통합 테스트 — 운영진이 정한 코드가 모임마다 초기화되지 않아야 한다

const realtimeStub = {
  broadcastSnapshot: () => undefined,
  broadcastSessionClosed: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();
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
  it('오늘 종료한 모임이 없으면 null', async () => {
    expect(await service.getClosedToday()).toBeNull();
    await service.open();
    expect(await service.getClosedToday()).toBeNull(); // 진행 중은 해당 없음
  });

  it('마지막에 종료한 모임과 출석 인원, 오늘 모임 수를 준다', async () => {
    const first = await service.open();
    const member = await prisma.member.create({ data: { name: '김민수', grade: 'C' } });
    await prisma.attendance.create({ data: { sessionId: first.id, memberId: member.id } });
    await service.close(first.id);

    const closed = await service.getClosedToday();

    expect(closed?.session.id).toBe(first.id);
    expect(closed?.attendeeCount).toBe(1);
    expect(closed?.sessionCountToday).toBe(1);
  });

  it('어제 종료한 모임은 해당 없음', async () => {
    const first = await service.open();
    await service.close(first.id);
    await prisma.session.update({ where: { id: first.id }, data: { date: new Date('2020-01-01') } });

    expect(await service.getClosedToday()).toBeNull();
  });
});
