import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

// 현황 묶어 보내기 — DB 없이 현황 만들기는 고정값으로 대신하고 보내는 횟수·순서만 본다
const gateway = { emitSnapshotUpdated: jest.fn(), emitSessionClosed: jest.fn() };
const service = new RealtimeService({} as PrismaService, gateway as unknown as RealtimeGateway);
const build = jest.spyOn(service, 'buildSnapshot').mockResolvedValue({} as never);

beforeEach(() => {
  jest.useFakeTimers();
  gateway.emitSnapshotUpdated.mockClear();
  gateway.emitSessionClosed.mockClear();
  build.mockClear();
});
afterEach(() => {
  service.onModuleDestroy();
  jest.useRealTimers();
});

describe('broadcastSnapshot', () => {
  it('짧은 사이 여러 번 불러도 모임마다 한 번만 만들어 보낸다', async () => {
    for (let i = 0; i < 20; i++) service.broadcastSnapshot('s1');
    service.broadcastSnapshot('s2');
    await jest.runAllTimersAsync();

    expect(build).toHaveBeenCalledTimes(2);
    expect(gateway.emitSnapshotUpdated).toHaveBeenCalledTimes(2);
  });

  it('보낸 뒤의 변경은 다시 보낸다', async () => {
    service.broadcastSnapshot('s1');
    await jest.runAllTimersAsync();
    service.broadcastSnapshot('s1');
    await jest.runAllTimersAsync();

    expect(gateway.emitSnapshotUpdated).toHaveBeenCalledTimes(2);
  });

  it('모임을 종료하면 보낼 예정이던 현황은 버리고 종료만 알린다', async () => {
    service.broadcastSnapshot('s1');
    service.broadcastSessionClosed('s1');
    await jest.runAllTimersAsync();

    expect(gateway.emitSnapshotUpdated).not.toHaveBeenCalled();
    expect(gateway.emitSessionClosed).toHaveBeenCalledWith('s1');
  });
});

// 현황 만들기 — 실제 DB로 공개 응답의 출생 연도 규칙만 본다
describe('buildSnapshot 출생 연도', () => {
  const prisma = new PrismaService();
  const real = new RealtimeService(prisma, gateway as unknown as RealtimeGateway);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('같은 모임에 이름이 같은 사람만 출생 연도가 실리고, 나머지는 비운다', async () => {
    jest.useRealTimers();
    const session = await prisma.session.create({ data: { date: new Date('2026-01-01'), checkInCode: '0101' } });
    const people = [
      { name: '스냅동명', birthDate: new Date('1990-01-01') },
      { name: '스냅동명', birthDate: new Date('1999-01-01') },
      { name: '스냅혼자', birthDate: new Date('1995-01-01') },
    ];
    for (const person of people) {
      const member = await prisma.member.create({ data: { ...person, grade: 'C', gender: 'MALE' } });
      await prisma.attendance.create({ data: { sessionId: session.id, memberId: member.id } });
    }

    const snapshot = await real.buildSnapshot(session.id);
    const year = (name: string) =>
      snapshot.attendances.filter((a) => a.member?.name === name).map((a) => a.member?.birthYear);

    expect(year('스냅동명').sort()).toEqual([1990, 1999]);
    expect(year('스냅혼자')).toEqual([null]);
  });
});
