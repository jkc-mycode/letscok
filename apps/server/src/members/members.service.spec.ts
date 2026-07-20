import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { MembersService } from './members.service';

// 회원 등록 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다
// (게스트 정책: 생년월일 없이 등록, 정회원은 기존대로 생년월일 포함)

const prisma = new PrismaService();
const service = new MembersService(prisma);

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
