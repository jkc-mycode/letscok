import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { MembersService } from './members.service';

// 회원 등록 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다
// (게스트 정책: 생년월일 없이 등록, 정회원은 기존대로 생년월일 포함)

// 브로드캐스트는 원장 변경과 무관 — 소켓 없이 서비스만 조립하기 위한 스텁
const realtimeStub = {
  broadcastSnapshot: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();
const service = new MembersService(prisma, realtimeStub);

const memberDto = (over: Partial<CreateMemberDto> = {}): CreateMemberDto => ({
  name: '홍길동',
  birthDate: '1997-03-12',
  grade: 'C',
  gender: 'MALE',
  isGuest: false,
  ...over,
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE admin_memos, game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('create', () => {
  it('정회원은 생년월일 포함으로 등록된다 (기존 동작 회귀)', async () => {
    const member = await service.create(memberDto());

    expect(member.birthDate).toBe('1997-03-12');
    expect(member.isGuest).toBe(false);
  });

  it('게스트는 생년월일 없이 등록되고 응답 birthDate는 null', async () => {
    const guest = await service.create(
      memberDto({ name: '김게스트', birthDate: undefined, isGuest: true }),
    );

    expect(guest.birthDate).toBeNull();
    expect(guest.isGuest).toBe(true);
  });

  it('게스트가 생년월일을 보내와도 무시하고 null 저장', async () => {
    const guest = await service.create(memberDto({ name: '김게스트', isGuest: true }));
    expect(guest.birthDate).toBeNull();
  });

  it('같은 이름 게스트 재등록은 409 — 더블탭 중복 방지', async () => {
    await service.create(memberDto({ name: '김게스트', birthDate: undefined, isGuest: true }));

    await expect(
      service.create(memberDto({ name: '김게스트', birthDate: undefined, isGuest: true })),
    ).rejects.toThrow(ConflictException);
  });

  it('이름이 같아도 정회원(생년월일 있음)과 게스트는 서로 중복이 아니다', async () => {
    await service.create(memberDto({ name: '박중복' }));

    const guest = await service.create(
      memberDto({ name: '박중복', birthDate: undefined, isGuest: true }),
    );
    expect(guest.isGuest).toBe(true);
  });

  it('정회원 이름+생년월일 중복은 여전히 409 (기존 동작 회귀)', async () => {
    await service.create(memberDto());
    await expect(service.create(memberDto())).rejects.toThrow(ConflictException);
  });
});

describe('search', () => {
  it('검색 결과에 게스트(null 생년월일)도 정상 포함된다', async () => {
    await service.create(memberDto({ name: '나정회' }));
    await service.create(memberDto({ name: '나게스', birthDate: undefined, isGuest: true }));

    const results = await service.search('나');

    expect(results).toHaveLength(2);
    expect(results.find((m) => m.name === '나게스')?.birthDate).toBeNull();
  });
});

// ===== 명단 관리 (수정·삭제·복구·승격·익명화) =====

async function seedOpenSessionWith(memberId: string) {
  const session = await prisma.session.create({
    data: { date: new Date('2026-01-01'), checkInCode: '0101' },
  });
  await prisma.attendance.create({
    data: { sessionId: session.id, memberId, waitingSince: new Date() },
  });
  return session;
}

describe('update', () => {
  it('급수·성별·역할이 반영된다', async () => {
    const member = await service.create(memberDto());

    const updated = await service.update(member.id, {
      grade: 'A',
      gender: 'FEMALE',
      role: 'MANAGER',
    });

    expect(updated.grade).toBe('A');
    expect(updated.gender).toBe('FEMALE');
    expect(updated.role).toBe('MANAGER');
  });

  it('이름 변경으로 기존 회원과 (이름, 생년월일)이 겹치면 409 — 등록과 같은 중복 재검사', async () => {
    await service.create(memberDto({ name: '김기존' }));
    const other = await service.create(memberDto({ name: '김변경' }));

    await expect(service.update(other.id, { name: '김기존' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('게스트 승격은 생년월일 필수, 승격하면 isGuest가 풀린다', async () => {
    const guest = await service.create(
      memberDto({ name: '김게스트', birthDate: undefined, isGuest: true }),
    );

    await expect(service.update(guest.id, { isGuest: false })).rejects.toThrow(
      ConflictException,
    );

    const promoted = await service.update(guest.id, {
      isGuest: false,
      birthDate: '1999-05-05',
    });
    expect(promoted.isGuest).toBe(false);
    expect(promoted.birthDate).toBe('1999-05-05');
  });

  it('게스트에게 역할 부여는 409 — 역할은 정회원 전용', async () => {
    const guest = await service.create(
      memberDto({ name: '김게스트', birthDate: undefined, isGuest: true }),
    );
    await expect(service.update(guest.id, { role: 'MANAGER' })).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('remove / restore', () => {
  it('삭제하면 검색에서 빠지고, 복구하면 돌아온다', async () => {
    const member = await service.create(memberDto({ name: '한삭제' }));

    await service.remove(member.id);
    expect(await service.search('한삭제')).toHaveLength(0);

    await service.restore(member.id);
    expect(await service.search('한삭제')).toHaveLength(1);
  });

  it('진행 중 모임에 체크인된 회원은 삭제 409 — 보드에 유령이 남는다', async () => {
    const member = await service.create(memberDto({ name: '한출석' }));
    await seedOpenSessionWith(member.id);

    await expect(service.remove(member.id)).rejects.toThrow(ConflictException);
  });

  it('삭제 사이 같은 (이름, 생년월일)이 새로 등록됐으면 복구 409', async () => {
    const member = await service.create(memberDto({ name: '한중복' }));
    await service.remove(member.id);
    await service.create(memberDto({ name: '한중복' })); // 같은 이름+생년월일 재등록

    await expect(service.restore(member.id)).rejects.toThrow(ConflictException);
  });
});

describe('anonymize', () => {
  it('이름·생년월일·성별이 지워지고 출석 기록은 남는다', async () => {
    const member = await service.create(memberDto({ name: '한탈퇴' }));
    const session = await seedOpenSessionWith(member.id);
    await prisma.session.update({ where: { id: session.id }, data: { status: 'CLOSED' } });

    await service.anonymize(member.id);

    const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.name).toBe('탈퇴한 모임원');
    expect(after.birthDate).toBeNull();
    expect(after.gender).toBeNull();
    expect(after.deletedAt).not.toBeNull(); // 명단·검색에서도 빠진다
    expect(
      await prisma.attendance.count({ where: { memberId: member.id } }),
    ).toBe(1); // 통계 무결성 — 기록 보존
  });
});

describe('list', () => {
  it('삭제 회원 포함 + 출석 집계(마지막 출석일·게임 수)가 실린다', async () => {
    const active = await service.create(memberDto({ name: '집계활성' }));
    const removed = await service.create(memberDto({ name: '집계삭제', birthDate: '1998-01-01' }));
    await service.remove(removed.id);
    const session = await seedOpenSessionWith(active.id);
    await prisma.attendance.updateMany({
      where: { memberId: active.id },
      data: { gamesPlayed: 3 },
    });
    await prisma.session.update({ where: { id: session.id }, data: { status: 'CLOSED' } });

    const list = await service.list();

    const activeRow = list.find((m) => m.id === active.id);
    expect(activeRow?.lastAttendedAt).toBe('2026-01-01');
    expect(activeRow?.totalSessions).toBe(1);
    expect(activeRow?.totalGames).toBe(3);
    const removedRow = list.find((m) => m.id === removed.id);
    expect(removedRow?.deletedAt).not.toBeNull(); // 복구 지원용으로 목록에 남는다
  });
});

describe('page (모임원 관리 목록)', () => {
  it('탭별 진짜 전체 인원(검색과 상관없이) + 탭·검색 거르기', async () => {
    await service.create(memberDto({ name: '김모임' }));
    await service.create(memberDto({ name: '이모임', birthDate: '1998-01-01' }));
    await service.create(memberDto({ name: '박손님', isGuest: true }));
    const removed = await service.create(memberDto({ name: '최삭제', birthDate: '1999-01-01' }));
    await service.remove(removed.id);

    const all = await service.page({});
    expect(all.counts).toEqual({ ALL: 3, REGULAR: 2, GUEST: 1, DELETED: 1 });
    expect(all.total).toBe(3);

    const searched = await service.page({ filter: 'REGULAR', q: '김' });
    expect(searched.items.map((m) => m.name)).toEqual(['김모임']);
    expect(searched.total).toBe(1);
    expect(searched.counts).toEqual(all.counts); // 검색해도 탭 숫자는 전체 그대로

    const deleted = await service.page({ filter: 'DELETED' });
    expect(deleted.items.map((m) => m.name)).toEqual(['최삭제']);
  });

  it('100명씩 나눠 준다 — 101명이면 2쪽에 1명', async () => {
    await prisma.member.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        name: `회원${String(i).padStart(3, '0')}`,
        grade: 'C' as const,
        gender: 'MALE' as const,
        birthDate: new Date('2000-01-01'),
      })),
    });

    const first = await service.page({ page: '1' });
    const second = await service.page({ page: '2' });

    expect(first.items).toHaveLength(100);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(101);
    expect(second.items[0].name).toBe('회원100'); // 미출석끼리는 이름순
  });

  it('오래 안 온 게스트 — 한 번도 안 왔거나 90일 넘게 미출석, 정회원·삭제는 제외', async () => {
    const never = await service.create(memberDto({ name: '안온게스트', isGuest: true }));
    await service.create(memberDto({ name: '정회원', birthDate: '1990-01-01' }));
    const recent = await service.create(memberDto({ name: '최근게스트', isGuest: true }));
    const session = await prisma.session.create({
      data: { date: new Date(), checkInCode: '0101', status: 'CLOSED' },
    });
    await prisma.attendance.create({ data: { sessionId: session.id, memberId: recent.id } });

    const stale = await service.staleGuests();

    expect(stale.map((m) => m.id)).toEqual([never.id]);
  });
});
