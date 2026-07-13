import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { AttendancesService } from './attendances.service';

// 체크인 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다
// (운영진 수동 체크인이 코드 대조만 빼고 공개 체크인과 같은 정책으로 동작하는지 + 공개 경로 코드 검증 회귀)

// 브로드캐스트는 상태 전이와 무관 — 소켓 없이 서비스만 조립하기 위한 스텁
const realtimeStub = {
  broadcastSnapshot: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();
const sessionsService = new SessionsService(prisma, realtimeStub);
const service = new AttendancesService(prisma, sessionsService, realtimeStub);

let seq = 0; // 회원 이름 중복 방지용 일련번호

async function seedSession(overrides: { status?: 'OPEN' | 'CLOSED'; checkInCode?: string | null } = {}) {
  return prisma.session.create({
    data: {
      date: new Date('2026-01-01'),
      status: overrides.status ?? 'OPEN',
      checkInCode: overrides.checkInCode === undefined ? 'TEST01' : overrides.checkInCode,
    },
  });
}

async function seedMember() {
  return prisma.member.create({
    data: {
      name: `테스트${++seq}`,
      grade: 'C',
      gender: 'MALE',
      birthDate: new Date('2000-01-01'),
    },
  });
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

describe('manualCheckIn', () => {
  it('첫 수동 체크인 — 코드 없이 CHECKED_IN 출석을 만든다', async () => {
    const session = await seedSession();
    const member = await seedMember();

    const attendance = await service.manualCheckIn(session.id, member.id);

    expect(attendance.status).toBe('CHECKED_IN');
    expect(attendance.memberId).toBe(member.id);
    expect(attendance.gamesPlayed).toBe(0);
  });

  it('LEFT 멤버는 재입장 — 같은 행 복귀, gamesPlayed 유지·waitingSince 리셋', async () => {
    const session = await seedSession();
    const member = await seedMember();
    const before = new Date(Date.now() - 60 * 60 * 1000);
    const left = await prisma.attendance.create({
      data: {
        sessionId: session.id,
        memberId: member.id,
        status: 'LEFT',
        gamesPlayed: 3,
        waitingSince: before,
        leftAt: new Date(),
      },
    });

    const reentered = await service.manualCheckIn(session.id, member.id);

    expect(reentered.id).toBe(left.id); // 새 행이 아니라 기존 출석 복귀
    expect(reentered.status).toBe('CHECKED_IN');
    expect(reentered.gamesPlayed).toBe(3);
    expect(new Date(reentered.waitingSince).getTime()).toBeGreaterThan(before.getTime());
  });

  it.each(['CHECKED_IN', 'MATCHED', 'PLAYING'] as const)(
    '%s 상태면 409 — 이미 출석 처리',
    async (status) => {
      const session = await seedSession();
      const member = await seedMember();
      await prisma.attendance.create({
        data: { sessionId: session.id, memberId: member.id, status },
      });

      await expect(service.manualCheckIn(session.id, member.id)).rejects.toThrow(
        ConflictException,
      );
    },
  );

  it('종료된 세션이면 실패한다', async () => {
    const session = await seedSession({ status: 'CLOSED' });
    const member = await seedMember();

    await expect(service.manualCheckIn(session.id, member.id)).rejects.toThrow();
  });

  it('삭제된(soft-delete) 멤버는 404', async () => {
    const session = await seedSession();
    const member = await seedMember();
    await prisma.member.update({
      where: { id: member.id },
      data: { deletedAt: new Date() },
    });

    await expect(service.manualCheckIn(session.id, member.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('checkIn (공개 경로 회귀 — 리팩터링으로 코드 검증이 안 깨졌는지)', () => {
  it('코드 불일치·누락은 403, 일치하면 체크인된다', async () => {
    const session = await seedSession({ checkInCode: 'ABC123' });
    const member = await seedMember();

    await expect(
      service.checkIn(session.id, { memberId: member.id, code: 'WRONG1' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.checkIn(session.id, { memberId: member.id }),
    ).rejects.toThrow(ForbiddenException);

    const ok = await service.checkIn(session.id, { memberId: member.id, code: 'ABC123' });
    expect(ok.status).toBe('CHECKED_IN');
  });

  it('수동 체크인된 멤버가 QR로 다시 체크인하면 409 — 본인 폰 클레임 시나리오', async () => {
    const session = await seedSession({ checkInCode: 'ABC123' });
    const member = await seedMember();
    await service.manualCheckIn(session.id, member.id);

    // 프론트는 이 409를 "본인 확인 완료"로 처리해 saveMemberId 후 /m 진입시킨다
    await expect(
      service.checkIn(session.id, { memberId: member.id, code: 'ABC123' }),
    ).rejects.toThrow(ConflictException);
  });
});
