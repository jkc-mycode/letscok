import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AttendancesService } from '../attendances/attendances.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  AiCheckInService,
  ExtractedName,
  normalizeName,
  UNSUPPORTED_COMMAND_MESSAGE,
} from './ai-check-in.service';
import { AiClient } from '../ai/ai.client';

// AI 체크인 매칭 통합 테스트 — 실DB로 "확실한 것만 자동" 규칙을 검증한다
// (AI가 읽어 낸 결과를 고정 입력으로 넣는다. AI 호출 자체는 ai.client.spec이 검증)

const realtimeStub = { broadcastSnapshot: () => undefined } as unknown as RealtimeService;
const pushStub = {} as unknown as PushService;
// AI 판독은 고정 결과로 대체 — 요청 모양(이미지·지시문)만 확인한다
const aiStub = { isEnabled: () => true, extract: jest.fn() };

const prisma = new PrismaService();
const sessionsService = new SessionsService(prisma, realtimeStub);
const attendancesService = new AttendancesService(prisma, sessionsService, realtimeStub, pushStub);
const service = new AiCheckInService(
  prisma,
  sessionsService,
  attendancesService,
  aiStub as unknown as AiClient,
);

// AI 추출 결과 1건 — 기본은 성+이름, 표기 없음
const full = (name: string, over: Partial<ExtractedName> = {}): ExtractedName => ({
  raw: name,
  name,
  kind: 'full',
  birthYear: null,
  guest: false,
  ...over,
});

async function seedSession() {
  return prisma.session.create({ data: { date: new Date('2026-01-01'), checkInCode: '0101' } });
}

async function seedMember(name: string, over: { birthDate?: string | null; isGuest?: boolean } = {}) {
  return prisma.member.create({
    data: {
      name,
      grade: 'C',
      birthDate: over.birthDate === null ? null : new Date(over.birthDate ?? '1995-05-05'),
      isGuest: over.isGuest ?? false,
    },
  });
}

async function attendedIds(sessionId: string) {
  const rows = await prisma.attendance.findMany({ where: { sessionId } });
  return rows.map((r) => r.memberId).sort();
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE push_subscriptions, admin_memos, game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('성+이름 (full)', () => {
  it('정확히 1명과 일치하면 자동 체크인, 이미 출석 중이면 alreadyIn', async () => {
    const session = await seedSession();
    const a = await seedMember('김하나');
    const b = await seedMember('이두울');
    await attendancesService.manualCheckIn(session.id, b.id);

    const result = await service.applyNames(session.id, [full('김하나'), full('이두울')]);

    expect(result.checkedIn).toEqual([{ memberId: a.id, name: '김하나' }]);
    expect(result.alreadyIn).toEqual([{ memberId: b.id, name: '이두울' }]);
    expect(await attendedIds(session.id)).toEqual([a.id, b.id].sort());
  });

  it('동명이인이면 체크인하지 않고 후보로 돌려준다', async () => {
    const session = await seedSession();
    await seedMember('김민수', { birthDate: '1995-01-01' });
    await seedMember('김민수', { birthDate: '1997-01-01' });

    const result = await service.applyNames(session.id, [full('김민수')]);

    expect(result.checkedIn).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates).toHaveLength(2);
    expect(result.ambiguous[0].reason).toBe('SAME_NAME');
    expect(await attendedIds(session.id)).toEqual([]);
  });

  it('생년 표기로 1명까지 좁혀지면 체크인 (두 자리 생년 97 → 1997)', async () => {
    const session = await seedSession();
    await seedMember('김민수', { birthDate: '1995-01-01' });
    const target = await seedMember('김민수', { birthDate: '1997-01-01' });

    const result = await service.applyNames(session.id, [full('김민수', { raw: '김민수(97)', birthYear: 97 })]);

    expect(result.checkedIn).toEqual([{ memberId: target.id, name: '김민수' }]);
  });

  it('게스트 표기로 1명까지 좁혀지면 체크인', async () => {
    const session = await seedSession();
    await seedMember('박세엣');
    const guest = await seedMember('박세엣', { birthDate: null, isGuest: true });

    const result = await service.applyNames(session.id, [full('박세엣', { guest: true })]);

    expect(result.checkedIn.map((m) => m.memberId)).toEqual([guest.id]);
  });

  it('후보가 1명이어도 생년 표기가 어긋나면 확실하지 않으니 후보로', async () => {
    const session = await seedSession();
    await seedMember('최네엣', { birthDate: '1995-01-01' });

    const result = await service.applyNames(session.id, [full('최네엣', { birthYear: 99 })]);

    expect(result.checkedIn).toEqual([]);
    expect(result.ambiguous[0].candidates).toHaveLength(1);
    expect(result.ambiguous[0].reason).toBe('HINT_MISMATCH');
  });

  it('없는 이름·삭제된 회원은 못 찾음(원문 표기로)', async () => {
    const session = await seedSession();
    const deleted = await seedMember('정다섯');
    await prisma.member.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    const result = await service.applyNames(session.id, [
      full('정다섯'),
      full('없는사람', { raw: '🏸없는사람' }),
    ]);

    expect(result.notFound.map((n) => n.name)).toEqual(['정다섯', '🏸없는사람']);
    expect(await attendedIds(session.id)).toEqual([]);
  });

  it('공백·이모지가 섞여도 같은 이름으로 맞추고, 여러 장에 중복되면 한 번만', async () => {
    const session = await seedSession();
    const member = await seedMember('한여섯');

    const result = await service.applyNames(session.id, [
      full('한 여섯🏸', { raw: '서울 한여섯🏸' }),
      full('한여섯'),
    ]);

    expect(result.checkedIn).toEqual([{ memberId: member.id, name: '한여섯' }]);
    expect(result.alreadyIn).toEqual([]);
  });
});

describe('이름만·별명·불명', () => {
  it('이름만(given)은 자동 체크인하지 않고 성 뺀 이름이 같은 회원을 후보로', async () => {
    const session = await seedSession();
    await seedMember('김강민');
    await seedMember('남궁강민');
    await seedMember('강민'); // 이름이 정확히 같은 회원도 후보에 — 외자 이름(오석)을 놓치지 않게

    const result = await service.applyNames(session.id, [
      { raw: '강민', name: '강민', kind: 'given', birthYear: null, guest: false },
    ]);

    expect(result.checkedIn).toEqual([]);
    expect(result.ambiguous[0].candidates.map((c) => c.name).sort()).toEqual(['강민', '김강민', '남궁강민']);
    expect(result.ambiguous[0].reason).toBe('GIVEN_ONLY');
  });

  it('외자 이름을 AI가 이름만(given)으로 읽어도, 정확히 같은 회원이 1명뿐이면 바로 출석', async () => {
    const session = await seedSession();
    const oh = await seedMember('오석');

    const result = await service.applyNames(session.id, [
      { raw: '오석 NEW', name: '오석', kind: 'given', birthYear: null, guest: false },
    ]);

    expect(result.checkedIn.map((m) => m.name)).toEqual(['오석']);
    expect(await attendedIds(session.id)).toEqual([oh.id]);
  });

  it('외자 이름을 불명(unclear)으로 읽으면 정확히 같은 회원을 후보로(자동 출석은 안 함)', async () => {
    const session = await seedSession();
    await seedMember('오석');

    const result = await service.applyNames(session.id, [
      { raw: '오석', name: '오석', kind: 'unclear', birthYear: null, guest: false },
    ]);

    expect(result.checkedIn).toEqual([]);
    expect(result.ambiguous[0].candidates.map((c) => c.name)).toEqual(['오석']);
    expect(result.ambiguous[0].reason).toBe('UNCLEAR');
  });

  it('별명·판단 불가는 원문으로 못 찾음', async () => {
    const session = await seedSession();
    await seedMember('김하나');

    const result = await service.applyNames(session.id, [
      { raw: '스매싱장인', name: '스매싱장인', kind: 'nickname', birthYear: null, guest: false },
      { raw: '하나?', name: '하나', kind: 'unclear', birthYear: null, guest: false },
    ]);

    expect(result.notFound.map((n) => n.name)).toEqual(['스매싱장인', '하나?']);
    expect(await attendedIds(session.id)).toEqual([]);
  });
});

describe('안내 문장과 세션', () => {
  it('결과를 정해진 틀로 조립한다 — 못 찾음·후보가 있으면 직접 체크인 안내', async () => {
    const session = await seedSession();
    await seedMember('김하나');
    await seedMember('김민수');
    await seedMember('김민수', { birthDate: '1999-09-09' });

    const result = await service.applyNames(session.id, [full('김하나'), full('김민수'), full('없음')]);

    expect(result.message).toBe(
      '1명 출석 처리했어요. 없음은(는) 못 찾았어요. 김민수은(는) 누구인지 확실하지 않아요. 직접 출석 처리해주세요.',
    );
  });

  it('읽은 이름이 없으면 그렇게 안내한다', async () => {
    const session = await seedSession();

    expect((await service.applyNames(session.id, [])).message).toBe('출석 처리할 이름을 찾지 못했어요.');
  });

  it('진행 중 모임이 아니면 404', async () => {
    const session = await seedSession();
    await prisma.session.update({ where: { id: session.id }, data: { status: 'CLOSED' } });

    await expect(service.applyNames(session.id, [full('김하나')])).rejects.toThrow(NotFoundException);
  });

  it('정규화 — NFC·공백·이모지', () => {
    expect(normalizeName(' 김 강민 🏸 ')).toBe('김강민');
  });
});

describe('checkInFromImages (캡처)', () => {
  const png = { buffer: Buffer.from('fake-png'), mimetype: 'image/png' };
  const jpeg = { buffer: Buffer.from('fake-jpeg'), mimetype: 'image/jpeg' };

  beforeEach(() => aiStub.extract.mockReset());

  it('캡처를 data URL 이미지로 실어 보내고, 읽은 이름을 같은 규칙으로 체크인한다', async () => {
    const session = await seedSession();
    const member = await seedMember('김하나');
    aiStub.extract.mockResolvedValue({ names: [full('김하나'), full('스매싱장인', { kind: 'nickname' })] });

    const result = await service.checkInFromImages(session.id, [png, jpeg]);

    expect(result.checkedIn).toEqual([{ memberId: member.id, name: '김하나' }]);
    expect(result.notFound.map((n) => n.name)).toEqual(['스매싱장인']);
    const content = aiStub.extract.mock.calls[0][3];
    expect(content.slice(0, 2)).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png.buffer.toString('base64')}` } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.buffer.toString('base64')}` } },
    ]);
    expect(content[2]).toMatchObject({ type: 'text' });
  });

  it('진행 중 모임이 아니면 AI를 부르지 않는다 — 비용 낭비 방지', async () => {
    const session = await seedSession();
    await prisma.session.update({ where: { id: session.id }, data: { status: 'CLOSED' } });

    await expect(service.checkInFromImages(session.id, [png])).rejects.toThrow(NotFoundException);
    expect(aiStub.extract).not.toHaveBeenCalled();
  });

  it('AI가 읽지 못하면(422 등) 체크인 없이 그 에러를 그대로 전달한다', async () => {
    const session = await seedSession();
    await seedMember('김하나');
    aiStub.extract.mockRejectedValue(new UnprocessableEntityException('내용을 읽지 못했어요.'));

    await expect(service.checkInFromImages(session.id, [png])).rejects.toThrow(UnprocessableEntityException);
    expect(await attendedIds(session.id)).toEqual([]);
  });
});

describe('checkInFromCommand (자연어 명령)', () => {
  beforeEach(() => aiStub.extract.mockReset());

  it('체크인 명령이면 뽑힌 대상을 같은 규칙으로 체크인한다 (명령 문장은 다듬어서 전달)', async () => {
    const session = await seedSession();
    await seedMember('김민수', { birthDate: '1995-01-01' });
    const target = await seedMember('김민수', { birthDate: '1997-01-01' });
    aiStub.extract.mockResolvedValue({
      action: 'check_in',
      targets: [full('김민수', { raw: '97년생 김민수', birthYear: 97 })],
    });

    const result = await service.checkInFromCommand(session.id, '  97년생 김민수 체크인해줘  ');

    expect(result.checkedIn).toEqual([{ memberId: target.id, name: '김민수' }]);
    expect(aiStub.extract.mock.calls[0][3]).toBe('97년생 김민수 체크인해줘');
  });

  it('체크인 외 요청(unsupported)은 아무것도 하지 않고 고정 안내만 — AI가 뽑은 이름이 있어도 무시', async () => {
    const session = await seedSession();
    await seedMember('김하나');
    aiStub.extract.mockResolvedValue({ action: 'unsupported', targets: [full('김하나')] });

    const result = await service.checkInFromCommand(session.id, '김하나 퇴장시켜줘');

    expect(result).toEqual({
      checkedIn: [],
      alreadyIn: [],
      notFound: [],
      ambiguous: [],
      message: UNSUPPORTED_COMMAND_MESSAGE,
    });
    expect(await attendedIds(session.id)).toEqual([]);
  });

  it('진행 중 모임이 아니면 AI를 부르지 않는다', async () => {
    const session = await seedSession();
    await prisma.session.update({ where: { id: session.id }, data: { status: 'CLOSED' } });

    await expect(service.checkInFromCommand(session.id, '김하나 체크인')).rejects.toThrow(NotFoundException);
    expect(aiStub.extract).not.toHaveBeenCalled();
  });
});


describe('소모임 이름 기억', () => {
  it('연결하면 출석하고 기억해서, 다음엔 성 없는 이름·별명도 묻지 않고 바로 출석', async () => {
    const session = await seedSession();
    const kim = await seedMember('김강민');
    await seedMember('남궁강민');

    const first = await service.applyNames(session.id, [
      { raw: '강민', name: '강민', kind: 'given', birthYear: null, guest: false },
      { raw: '콕콕이', name: '콕콕이', kind: 'nickname', birthYear: null, guest: false },
    ]);
    expect(first.ambiguous[0].alias).toBe('강민');
    expect(first.notFound).toEqual([{ name: '콕콕이', alias: '콕콕이' }]);

    const linked = await service.link(session.id, { memberId: kim.id, alias: '강민' });
    expect(linked).toEqual({ member: { memberId: kim.id, name: '김강민' }, alreadyIn: false });
    const again = await service.link(session.id, { memberId: kim.id, alias: '콕콕 이' }); // 공백은 정규화
    expect(again.alreadyIn).toBe(true);

    // 다음 모임 — 같은 표기는 바로 출석
    await prisma.session.update({ where: { id: session.id }, data: { status: 'CLOSED' } });
    const next = await seedSession();
    const result = await service.applyNames(next.id, [
      { raw: '강민', name: '강민', kind: 'given', birthYear: null, guest: false },
      { raw: '콕콕이', name: '콕콕이', kind: 'nickname', birthYear: null, guest: false },
    ]);
    expect(result.checkedIn.map((m) => m.name)).toEqual(['김강민']);
    expect(result.alreadyIn).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.notFound).toEqual([]);
  });

  it('같은 표기를 다른 사람과 다시 연결하면 새 사람으로 바뀌고, 삭제된 회원을 가리키면 무시', async () => {
    const session = await seedSession();
    const a = await seedMember('김강민');
    const b = await seedMember('이강민');
    await service.link(session.id, { memberId: a.id, alias: '강민' });
    await service.link(session.id, { memberId: b.id, alias: '강민' });
    expect((await prisma.memberAlias.findUnique({ where: { alias: '강민' } }))?.memberId).toBe(b.id);

    await prisma.member.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
    await prisma.attendance.deleteMany({ where: { sessionId: session.id } });
    const result = await service.applyNames(session.id, [
      { raw: '강민', name: '강민', kind: 'given', birthYear: null, guest: false },
    ]);
    expect(result.checkedIn).toEqual([]);
    expect(result.ambiguous[0].candidates.map((c) => c.name)).toEqual(['김강민']);
  });
});
