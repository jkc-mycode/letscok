import { ConflictException } from '@nestjs/common';
import { MemosService } from '../memos/memos.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { PartnersService } from './partners.service';

// 대회 연습 파트너 지정·해제 — 실DB로 서로 가리키기·이전 짝 풀기·메모 기록을 확인한다

const realtimeStub = { broadcastSnapshot: () => undefined } as unknown as RealtimeService;
const prisma = new PrismaService();
const sessionsService = new SessionsService(prisma, realtimeStub);
const service = new PartnersService(prisma, sessionsService, realtimeStub, new MemosService(prisma, realtimeStub));

let seq = 0;
async function seedAttendee(sessionId: string, status: 'CHECKED_IN' | 'LEFT' = 'CHECKED_IN') {
  const member = await prisma.member.create({
    data: { name: `파트너${++seq}`, grade: 'C', gender: 'MALE', birthDate: new Date('2000-01-01') },
  });
  return prisma.attendance.create({ data: { sessionId, memberId: member.id, status } });
}
const partnerOf = async (id: string) =>
  (await prisma.attendance.findUniqueOrThrow({ where: { id } })).partnerAttendanceId;

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members, admin_memos CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PartnersService', () => {
  it('지정하면 서로를 가리키고 메모가 남는다, 새로 지정하면 이전 짝은 풀린다, 해제하면 둘 다 풀린다', async () => {
    const session = await prisma.session.create({ data: { date: new Date('2026-01-01'), checkInCode: '0101' } });
    const [a, b, c] = [await seedAttendee(session.id), await seedAttendee(session.id), await seedAttendee(session.id)];

    await service.set(session.id, [a.id, b.id]);
    expect(await partnerOf(a.id)).toBe(b.id);
    expect(await partnerOf(b.id)).toBe(a.id);
    const memos = await prisma.adminMemo.findMany();
    expect(memos).toHaveLength(1);
    expect(memos[0].content).toContain('대회 연습 파트너');

    await service.set(session.id, [a.id, c.id]);
    expect(await partnerOf(a.id)).toBe(c.id);
    expect(await partnerOf(b.id)).toBeNull(); // 예전 짝 풀림

    await service.clear(c.id);
    expect(await partnerOf(a.id)).toBeNull();
    expect(await partnerOf(c.id)).toBeNull();
  });

  it('퇴장한 사람·같은 사람 두 번은 안 된다', async () => {
    const session = await prisma.session.create({ data: { date: new Date('2026-01-01'), checkInCode: '0101' } });
    const a = await seedAttendee(session.id);
    const gone = await seedAttendee(session.id, 'LEFT');
    await expect(service.set(session.id, [a.id, gone.id])).rejects.toThrow(ConflictException);
    await expect(service.set(session.id, [a.id, a.id])).rejects.toThrow();
  });
});
