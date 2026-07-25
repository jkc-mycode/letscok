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
      checkInCode: overrides.checkInCode === undefined ? '0101' : overrides.checkInCode,
    },
  });
}

// 동의를 이미 마친 회원이 기본 — 미동의(운영진 대리 등록 직후) 케이스만 명시적으로 null로 바꾼다
async function seedMember() {
  return prisma.member.create({
    data: {
      name: `테스트${++seq}`,
      grade: 'C',
      gender: 'MALE',
      birthDate: new Date('2000-01-01'),
      consentedAt: new Date('2026-01-01'),
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
    const session = await seedSession({ checkInCode: '0715' });
    const member = await seedMember();

    await expect(
      service.checkIn(session.id, { memberId: member.id, code: '9999' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.checkIn(session.id, { memberId: member.id }),
    ).rejects.toThrow(ForbiddenException);

    const ok = await service.checkIn(session.id, { memberId: member.id, code: '0715' });
    expect(ok.status).toBe('CHECKED_IN');
  });

  it('수동 체크인된 멤버가 코드로 다시 체크인하면 409 — 본인 폰 클레임 시나리오', async () => {
    const session = await seedSession({ checkInCode: '0715' });
    const member = await seedMember();
    await service.manualCheckIn(session.id, member.id);

    // 프론트는 이 409를 "본인 확인 완료"로 처리해 saveMemberId 후 /m 진입시킨다
    await expect(
      service.checkIn(session.id, { memberId: member.id, code: '0715' }),
    ).rejects.toThrow(ConflictException);
  });

  // 코드가 숫자 4자리(1만 가지)라 대입 방어가 필요하다 — 실패만 세고 IP 단위로 잠근다
  it('코드를 10번 틀리면 같은 IP는 429로 잠기고, 다른 IP는 영향 없다', async () => {
    const session = await seedSession({ checkInCode: '0715' });
    const member = await seedMember();
    const attacker = '203.0.113.10';

    for (let i = 0; i < 10; i++) {
      await expect(
        service.checkIn(session.id, { memberId: member.id, code: '9999' }, attacker),
      ).rejects.toThrow(ForbiddenException);
    }

    // 잠긴 뒤엔 정답을 넣어도 통과하지 못한다
    await expect(
      service.checkIn(session.id, { memberId: member.id, code: '0715' }, attacker),
    ).rejects.toThrow('코드를 여러 번 잘못 입력했어요. 잠시 후 다시 시도해주세요.');

    // 공용 와이파이 우려와 별개로, 실패를 안 낸 IP는 그대로 체크인된다
    const ok = await service.checkIn(
      session.id,
      { memberId: member.id, code: '0715' },
      '203.0.113.11',
    );
    expect(ok.status).toBe('CHECKED_IN');
  });
});

describe('첫 체크인 개인정보 동의 (운영진 대리 등록분)', () => {
  async function seedUnconsentedMember() {
    const member = await seedMember();
    return prisma.member.update({
      where: { id: member.id },
      data: { consentedAt: null },
    });
  }

  it('동의 이력이 없으면 consent 없이는 403', async () => {
    const session = await seedSession({ checkInCode: '0715' });
    const member = await seedUnconsentedMember();

    await expect(
      service.checkIn(session.id, { memberId: member.id, code: '0715' }),
    ).rejects.toThrow('개인정보 수집·이용에 동의해주세요.');
  });

  it('동의하면 시각이 기록되고 체크인된다', async () => {
    const session = await seedSession({ checkInCode: '0715' });
    const member = await seedUnconsentedMember();

    const attendance = await service.checkIn(session.id, {
      memberId: member.id,
      code: '0715',
      consent: true,
    });

    expect(attendance.status).toBe('CHECKED_IN');
    const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.consentedAt).not.toBeNull();
  });

  it('수동 체크인된 사람이 폰으로 클레임할 때도 동의가 먼저 기록된다 (409보다 앞)', async () => {
    const session = await seedSession({ checkInCode: '0715' });
    const member = await seedUnconsentedMember();
    await service.manualCheckIn(session.id, member.id); // 운영진이 미리 체크인

    await expect(
      service.checkIn(session.id, { memberId: member.id, code: '0715', consent: true }),
    ).rejects.toThrow(ConflictException); // 클레임 신호인 409는 그대로

    const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.consentedAt).not.toBeNull(); // 409에 가려 동의가 유실되면 안 된다
  });

  it('운영진 수동 체크인은 동의를 요구하지 않는다 (본인이 아직 오지 않았을 수 있음)', async () => {
    const session = await seedSession();
    const member = await seedUnconsentedMember();

    const attendance = await service.manualCheckIn(session.id, member.id);

    expect(attendance.status).toBe('CHECKED_IN');
  });
});

describe('rest / resume (잠깐 휴식)', () => {
  async function seedCheckedIn() {
    const session = await seedSession();
    const member = await seedMember();
    return service.manualCheckIn(session.id, member.id);
  }

  it('대기(CHECKED_IN) → 휴식, waitingSince가 휴식 시작 시각으로 갱신', async () => {
    const checkedIn = await seedCheckedIn();

    const resting = await service.rest(checkedIn.id);

    expect(resting.status).toBe('RESTING');
    expect(new Date(resting.waitingSince).getTime()).toBeGreaterThan(
      new Date(checkedIn.waitingSince).getTime() - 1,
    );
  });

  it('복귀하면 CHECKED_IN + 대기시간 리셋 (쉬는 동안은 기다린 게 아님)', async () => {
    const checkedIn = await seedCheckedIn();
    await service.rest(checkedIn.id);
    // 휴식 시작을 과거로 밀어 리셋 여부를 시간차로 검증
    const past = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.attendance.update({
      where: { id: checkedIn.id },
      data: { waitingSince: past },
    });

    const resumed = await service.resume(checkedIn.id);

    expect(resumed.status).toBe('CHECKED_IN');
    expect(new Date(resumed.waitingSince).getTime()).toBeGreaterThan(past.getTime());
  });

  it('조합(MATCHED)·게임 중(PLAYING)엔 휴식 불가 — 운영진 안내 메시지 409', async () => {
    for (const status of ['MATCHED', 'PLAYING'] as const) {
      const checkedIn = await seedCheckedIn();
      await prisma.attendance.update({ where: { id: checkedIn.id }, data: { status } });

      await expect(service.rest(checkedIn.id)).rejects.toThrow(
        '이미 게임 조합에 들어가 있어요. 쉬려면 운영진에게 말씀해주세요.',
      );
    }
  });

  it('더블탭 안전 — 휴식 중 rest, 대기 중 resume은 에러 없이 현재 상태 반환', async () => {
    const checkedIn = await seedCheckedIn();

    expect((await service.resume(checkedIn.id)).status).toBe('CHECKED_IN');
    await service.rest(checkedIn.id);
    expect((await service.rest(checkedIn.id)).status).toBe('RESTING');
  });

  it('퇴장(LEFT) 상태에선 휴식·복귀 모두 409', async () => {
    const checkedIn = await seedCheckedIn();
    await service.leave(checkedIn.id);

    await expect(service.rest(checkedIn.id)).rejects.toThrow(ConflictException);
    await expect(service.resume(checkedIn.id)).rejects.toThrow(ConflictException);
  });

  it('휴식 중인 사람은 퇴장 처리 가능 (쉬다가 그냥 가는 경우)', async () => {
    const checkedIn = await seedCheckedIn();
    await service.rest(checkedIn.id);

    const left = await service.leave(checkedIn.id);
    expect(left.status).toBe('LEFT');
  });
});

describe('confirmShuttle / cancelShuttle (콕 제출 확인)', () => {
  async function seedCheckedIn() {
    const session = await seedSession();
    const member = await seedMember();
    return service.manualCheckIn(session.id, member.id);
  }

  it('체크인 직후엔 콕 미확인 상태다', async () => {
    const checkedIn = await seedCheckedIn();

    expect(checkedIn.shuttleConfirmedAt).toBeNull();
  });

  it('확인하면 시각이 남고 waitingSince가 그 시점으로 맞춰진다', async () => {
    const checkedIn = await seedCheckedIn();
    // 체크인을 과거로 밀어 "콕 확인 시점부터 참여" 규칙을 시간차로 검증
    const past = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.attendance.update({
      where: { id: checkedIn.id },
      data: { waitingSince: past },
    });

    const confirmed = await service.confirmShuttle(checkedIn.id);

    expect(confirmed.shuttleConfirmedAt).not.toBeNull();
    expect(new Date(confirmed.waitingSince).getTime()).toBeGreaterThan(
      past.getTime(),
    );
    expect(confirmed.waitingSince).toBe(confirmed.shuttleConfirmedAt);
  });

  it('더블탭 안전 — 이미 확인됐으면 시각을 덮어쓰지 않는다', async () => {
    const checkedIn = await seedCheckedIn();
    const first = await service.confirmShuttle(checkedIn.id);

    const second = await service.confirmShuttle(checkedIn.id);

    expect(second.shuttleConfirmedAt).toBe(first.shuttleConfirmedAt);
  });

  it('취소하면 다시 미확인으로 돌아간다', async () => {
    const checkedIn = await seedCheckedIn();
    await service.confirmShuttle(checkedIn.id);

    const cancelled = await service.cancelShuttle(checkedIn.id);

    expect(cancelled.shuttleConfirmedAt).toBeNull();
  });

  it('조합·게임에 배정된 사람은 취소 불가 — 진행 중 게임이 깨지지 않게', async () => {
    for (const status of ['MATCHED', 'PLAYING'] as const) {
      const checkedIn = await seedCheckedIn();
      await service.confirmShuttle(checkedIn.id);
      await prisma.attendance.update({ where: { id: checkedIn.id }, data: { status } });

      await expect(service.cancelShuttle(checkedIn.id)).rejects.toThrow(
        ConflictException,
      );
    }
  });

  it('퇴장한 사람은 콕 확인 불가', async () => {
    const checkedIn = await seedCheckedIn();
    await service.leave(checkedIn.id);

    await expect(service.confirmShuttle(checkedIn.id)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('cancelCheckIn (출석 취소 — 사전 체크인 노쇼)', () => {
  it('콕 확인 전 출석은 행이 삭제되고, 다시 체크인하면 새 행으로 시작한다', async () => {
    const session = await seedSession();
    const member = await seedMember();
    const attendance = await service.manualCheckIn(session.id, member.id);

    await service.cancelCheckIn(attendance.id);

    // 퇴장(LEFT)과 달리 흔적이 없다 — 출석·랭킹 집계에 안 잡힌다
    expect(
      await prisma.attendance.count({ where: { memberId: member.id } }),
    ).toBe(0);

    const again = await service.manualCheckIn(session.id, member.id);
    expect(again.id).not.toBe(attendance.id);
    expect(again.status).toBe('CHECKED_IN');
  });

  it('콕 확인된 출석은 409 — 실제 참석자는 퇴장 처리로', async () => {
    const session = await seedSession();
    const member = await seedMember();
    const attendance = await service.manualCheckIn(session.id, member.id);
    await service.confirmShuttle(attendance.id);

    await expect(service.cancelCheckIn(attendance.id)).rejects.toThrow(
      ConflictException,
    );
  });
});
