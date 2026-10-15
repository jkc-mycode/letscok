import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CourtsService } from './courts.service';

// 코트 번호 바꾸기 — 실제 Prisma+테스트 DB로 고유 번호 규칙을 본다
const realtimeStub = { broadcastSnapshot: () => undefined } as unknown as RealtimeService;
const prisma = new PrismaService();
const service = new CourtsService(prisma, new SessionsService(prisma, realtimeStub), realtimeStub);

const seedSession = () => prisma.session.create({ data: { date: new Date('2026-01-01'), checkInCode: '0101' } });
const seedCourt = (sessionId: string, courtNo: number, deletedAt: Date | null = null) =>
  prisma.court.create({ data: { sessionId, courtNo, deletedAt } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('renumber', () => {
  it('번호만 바뀌고, 그 코트에서 끝난 게임도 새 번호로 이어진다', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id, 1);
    const game = await prisma.game.create({ data: { sessionId: session.id, courtId: court.id, status: 'FINISHED' } });

    const renamed = await service.renumber(court.id, { courtNo: 7 });

    expect(renamed.courtNo).toBe(7);
    const after = await prisma.game.findUniqueOrThrow({ where: { id: game.id }, include: { court: true } });
    expect(after.court?.courtNo).toBe(7);
  });

  it('다른 코트가 쓰는 번호면 409, 번호는 그대로', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id, 1);
    await seedCourt(session.id, 2);

    await expect(service.renumber(court.id, { courtNo: 2 })).rejects.toThrow('이미 2번 코트가 있어요');
    expect((await prisma.court.findUniqueOrThrow({ where: { id: court.id } })).courtNo).toBe(1);
  });

  it('해제된 코트가 그 번호를 쥐고 있으면 — 기록이 없으면 지우고 바꾼다', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id, 1);
    const removed = await seedCourt(session.id, 2, new Date());

    await expect(service.renumber(court.id, { courtNo: 2 })).resolves.toMatchObject({ courtNo: 2 });
    expect(await prisma.court.findUnique({ where: { id: removed.id } })).toBeNull();
  });

  it('해제된 코트에 게임 기록이 있으면 409 — 지난 기록의 번호가 바뀌면 안 된다', async () => {
    const session = await seedSession();
    const court = await seedCourt(session.id, 1);
    const removed = await seedCourt(session.id, 2, new Date());
    await prisma.game.create({ data: { sessionId: session.id, courtId: removed.id, status: 'FINISHED' } });

    await expect(service.renumber(court.id, { courtNo: 2 })).rejects.toThrow(ConflictException);
  });
});
