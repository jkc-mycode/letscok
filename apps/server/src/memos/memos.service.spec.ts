import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MemosService } from './memos.service';

// 운영 메모 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다
// (전역 수명: 세션 종료와 무관하게 유지 / 추가·삭제·전체 초기화)

// 브로드캐스트는 메모 CRUD와 무관 — 소켓 없이 서비스만 조립하기 위한 스텁
const realtimeStub = {
  broadcastSnapshot: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();
const service = new MemosService(prisma, realtimeStub);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE admin_memos, game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('memos', () => {
  it('추가하면 오래된 순으로 목록에 나온다 (내용은 trim)', async () => {
    await service.create('  첫 메모  ');
    await service.create('둘째 메모');

    const memos = await service.list();

    expect(memos.map((m) => m.content)).toEqual(['첫 메모', '둘째 메모']);
  });

  it('세션이 닫혀도(모임 종료) 메모는 유지된다 — 전역 수명', async () => {
    const session = await prisma.session.create({
      data: { date: new Date('2026-01-01') },
    });
    await service.create('다음 모임에 파트너 게임');
    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    const memos = await service.list();
    expect(memos).toHaveLength(1);
  });

  it('세션이 아예 없어도 추가·조회된다 — 세션 무관', async () => {
    await service.create('모임 밖 메모');
    expect(await service.list()).toHaveLength(1);
  });

  it('개별 삭제 = 완료 처리, 없는 id는 404', async () => {
    const memo = await service.create('처리할 일');
    await service.remove(memo.id);

    expect(await service.list()).toEqual([]);
    await expect(service.remove(memo.id)).rejects.toThrow(NotFoundException);
  });

  it('전체 초기화는 모든 메모를 지우고 삭제 수를 반환한다', async () => {
    await service.create('하나');
    await service.create('둘');

    const result = await service.clear();

    expect(result.deleted).toBe(2);
    expect(await service.list()).toEqual([]);
  });
});
