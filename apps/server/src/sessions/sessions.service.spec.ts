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
