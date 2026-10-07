import { AiClient } from '../ai/ai.client';
import { AiCheckInService } from '../ai-check-in/ai-check-in.service';
import { AttendancesService } from '../attendances/attendances.service';
import { RecommendationsService } from '../games/recommendations.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { AiCommandService, UNCLEAR_MESSAGE, UNSUPPORTED_MESSAGE } from './ai-command.service';

// AI 운영 명령 통합 테스트 — AI 판독은 고정 결과로 대체하고, 대상 찾기·추천 연결·미리보기 구성을 실DB로 검증한다

const realtimeStub = { broadcastSnapshot: () => undefined } as unknown as RealtimeService;
const pushStub = {} as unknown as PushService;
const aiStub = { isEnabled: () => true, extract: jest.fn() };

const prisma = new PrismaService();
const sessionsService = new SessionsService(prisma, realtimeStub);
const attendancesService = new AttendancesService(prisma, sessionsService, realtimeStub, pushStub);
const ai = aiStub as unknown as AiClient;
const service = new AiCommandService(
  prisma,
  sessionsService,
  new RecommendationsService(prisma, sessionsService),
  new AiCheckInService(prisma, sessionsService, attendancesService, ai),
  ai,
);

// AI가 돌려줄 명령 — 기본은 아무것도 지정 안 한 make_game
const command = (over: Record<string, unknown> = {}) => ({
  action: 'make_game',
  category: 'ALL',
  people: [],
  courtNo: null,
  checkInTargets: [],
  feature: 'other',
  question: 'other',
  guests: [],
  ...over,
});

async function seedSession() {
  return prisma.session.create({ data: { date: new Date('2026-01-01'), checkInCode: '0101' } });
}

async function seedAttendee(
  sessionId: string,
  name: string,
  gender: 'MALE' | 'FEMALE' = 'MALE',
  status: 'CHECKED_IN' | 'PLAYING' | 'RESTING' = 'CHECKED_IN',
) {
  const member = await prisma.member.create({
    data: { name, grade: 'C', gender, birthDate: new Date('1997-05-05') },
  });
  return prisma.attendance.create({
    data: {
      sessionId,
      memberId: member.id,
      status,
      waitingSince: new Date('2026-01-01T10:00:00Z'),
      shuttleConfirmedAt: new Date('2026-01-01T09:00:00Z'),
    },
  });
}

beforeEach(async () => {
  aiStub.extract.mockReset();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AiCommandService.run', () => {
  it('게임 짜기 — 성 없이 "민수"만 말해도 오늘 출석자 중 한 명이면 지정 인원으로 추천', async () => {
    const session = await seedSession();
    const minsu = await seedAttendee(session.id, '김민수');
    for (const name of ['박철수', '최영호', '정대현', '한지훈']) await seedAttendee(session.id, name);
    aiStub.extract.mockResolvedValue(command({ category: 'MENS', people: ['민수'] }));

    const result = await service.run(session.id, '민수 넣어서 남복 짜줘');

    expect(result.kind).toBe('game_preview');
    if (result.kind !== 'game_preview') return;
    expect(result.category).toBe('MENS');
    const pinned = result.recommendations[0].players.filter((p) => p.pinned).map((p) => p.attendanceId);
    expect(pinned).toEqual([minsu.id]);
  });

  it('이름이 여러 명과 맞으면 고르기(구분 정보 포함), 못 찾으면 안내', async () => {
    const session = await seedSession();
    await seedAttendee(session.id, '김민수');
    await seedAttendee(session.id, '이민수');

    aiStub.extract.mockResolvedValueOnce(command({ people: ['민수'] }));
    const choose = await service.run(session.id, '민수 넣어서 짜줘');
    expect(choose.kind).toBe('choose');
    if (choose.kind === 'choose') {
      expect(choose.unresolved[0].candidates.map((c) => c.name).sort()).toEqual(['김민수', '이민수']);
      expect(choose.unresolved[0].candidates[0].detail).toBe('C급 · 97년생');
    }

    aiStub.extract.mockResolvedValueOnce(command({ people: ['준호'] }));
    const missing = await service.run(session.id, '준호 넣어서 짜줘');
    expect(missing).toEqual({ kind: 'message', text: '오늘 출석자 중에 준호님이(가) 없어요.' });
  });

  it('게임 종료 — 코트 번호로 진행 중 게임을 찾아 미리보기, 없으면 안내', async () => {
    const session = await seedSession();
    const court = await prisma.court.create({ data: { sessionId: session.id, courtNo: 3, status: 'IN_GAME' } });
    const players = [];
    for (const name of ['김하나', '이두리', '박세나', '최네오']) players.push(await seedAttendee(session.id, name, 'MALE', 'PLAYING'));
    const game = await prisma.game.create({
      data: {
        sessionId: session.id,
        courtId: court.id,
        status: 'PLAYING',
        startedAt: new Date(),
        players: { createMany: { data: players.map((p) => ({ attendanceId: p.id })) } },
      },
    });

    aiStub.extract.mockResolvedValueOnce(command({ action: 'finish_game', courtNo: 3 }));
    const preview = await service.run(session.id, '3번 코트 끝났어');
    expect(preview).toMatchObject({ kind: 'action_preview', action: 'finish_game', gameId: game.id });
    if (preview.kind === 'action_preview') expect(preview.label).toContain('3번 코트 게임 종료');

    aiStub.extract.mockResolvedValueOnce(command({ action: 'finish_game', courtNo: 1 }));
    expect(await service.run(session.id, '1번 코트 끝났어')).toEqual({
      kind: 'message',
      text: '1번 코트에는 진행 중인 게임이 없어요.',
    });
  });

  it('휴식·호출 — 대상만 찾아 미리보기(실행은 하지 않음)', async () => {
    const session = await seedSession();
    const jun = await seedAttendee(session.id, '이준호');
    aiStub.extract.mockResolvedValue(command({ action: 'rest', people: ['준호'] }));

    const result = await service.run(session.id, '준호 휴식');

    expect(result).toMatchObject({ kind: 'action_preview', action: 'rest', label: '이준호 휴식' });
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: jun.id } });
    expect(after.status).toBe('CHECKED_IN'); // 미리보기만 — 상태는 그대로
  });

  it('지원 안 함·못 알아들음·앱에 있는 기능은 서버 고정 문구', async () => {
    const session = await seedSession();
    aiStub.extract.mockResolvedValueOnce(command({ action: 'unsupported' }));
    expect(await service.run(session.id, '오늘 날씨 어때')).toEqual({ kind: 'message', text: UNSUPPORTED_MESSAGE });
    aiStub.extract.mockResolvedValueOnce(command({ action: 'unclear' }));
    expect(await service.run(session.id, '어어 그 저')).toEqual({ kind: 'message', text: UNCLEAR_MESSAGE });
    aiStub.extract.mockResolvedValueOnce(command({ action: 'known_unsupported', feature: 'close_session' }));
    const guide = await service.run(session.id, '모임 끝내줘');
    expect(guide.kind === 'message' && guide.text).toContain('[모임 종료]');
  });

  it('체크인 — 기존 AI 체크인 규칙으로 처리', async () => {
    const session = await seedSession();
    await prisma.member.create({ data: { name: '홍길동', grade: 'C', gender: 'MALE', birthDate: new Date('1990-01-01') } });
    aiStub.extract.mockResolvedValue(
      command({
        action: 'check_in',
        checkInTargets: [{ raw: '홍길동', name: '홍길동', kind: 'full', birthYear: null, guest: false }],
      }),
    );

    const result = await service.run(session.id, '홍길동 체크인');

    expect(result.kind).toBe('check_in');
    if (result.kind === 'check_in') expect(result.result.checkedIn.map((m) => m.name)).toEqual(['홍길동']);
  });
});

describe('AiCommandService.run — 상황 질문', () => {
  const ask = (question: string, people: string[] = []) => command({ action: 'ask', question, people });

  it('가장 오래 기다린 사람 — 조합 없이 기다리는 사람만, 오래된 순 3명', async () => {
    const session = await seedSession();
    const names = ['김하나', '이두리', '박세나', '최네오'];
    const rows = [];
    for (const name of names) rows.push(await seedAttendee(session.id, name));
    // 두리가 가장 오래, 네오는 휴식이라 빠진다
    const since = ['2026-01-01T10:20:00Z', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z', '2026-01-01T09:00:00Z'];
    for (const [i, row] of rows.entries()) {
      await prisma.attendance.update({ where: { id: row.id }, data: { waitingSince: new Date(since[i]) } });
    }
    await prisma.attendance.update({ where: { id: rows[3].id }, data: { status: 'RESTING' } });
    aiStub.extract.mockResolvedValue(ask('longest_wait'));

    const result = await service.run(session.id, '누가 제일 오래 기다렸어?');

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.lines.map((l) => l.split(' — ')[0])).toEqual(['이두리', '박세나', '김하나']);
    }
  });

  it('사람 현황 — 게임 수와 지금 위치(코트 번호), 없는 이름은 안내', async () => {
    const session = await seedSession();
    const court = await prisma.court.create({ data: { sessionId: session.id, courtNo: 2, status: 'IN_GAME' } });
    const players = [];
    for (const name of ['김민수', '이두리', '박세나', '최네오']) players.push(await seedAttendee(session.id, name, 'MALE', 'PLAYING'));
    await prisma.attendance.update({ where: { id: players[0].id }, data: { gamesPlayed: 3 } });
    await prisma.game.create({
      data: {
        sessionId: session.id,
        courtId: court.id,
        status: 'PLAYING',
        startedAt: new Date(),
        players: { createMany: { data: players.map((p) => ({ attendanceId: p.id })) } },
      },
    });

    aiStub.extract.mockResolvedValueOnce(ask('person', ['민수']));
    expect(await service.run(session.id, '민수 오늘 몇 게임 했어?')).toEqual({
      kind: 'answer',
      title: '사람 현황',
      lines: ['김민수 — 오늘 3게임 · 2번 코트에서 게임 중'],
    });

    aiStub.extract.mockResolvedValueOnce(ask('person', ['준호']));
    expect(await service.run(session.id, '준호 어디 있어?')).toEqual({
      kind: 'message',
      text: '오늘 출석자 중에 준호님이(가) 없어요.',
    });
  });

  it('0게임·빈 코트·인원 현황·다음 게임 — 빈칸 조합은 다음 게임으로 치지 않는다', async () => {
    const session = await seedSession();
    await prisma.court.create({ data: { sessionId: session.id, courtNo: 1 } });
    await prisma.court.create({ data: { sessionId: session.id, courtNo: 2, isShared: true, ourTurn: false } });
    const rows = [];
    for (const name of ['김하나', '이두리', '박세나', '최네오', '정다섯']) rows.push(await seedAttendee(session.id, name));
    await prisma.attendance.update({ where: { id: rows[4].id }, data: { gamesPlayed: 2 } });
    // 빈칸 조합(1명)이 먼저, 4명 조합이 뒤
    await prisma.game.create({
      data: { sessionId: session.id, queueOrder: 1, players: { create: { attendanceId: rows[4].id } } },
    });
    await prisma.game.create({
      data: {
        sessionId: session.id,
        queueOrder: 2,
        players: { createMany: { data: rows.slice(0, 4).map((r) => ({ attendanceId: r.id })) } },
      },
    });

    aiStub.extract.mockResolvedValueOnce(ask('no_games'));
    const zero = await service.run(session.id, '아직 한 게임도 못 한 사람?');
    expect(zero.kind === 'answer' && zero.lines.length).toBe(4);

    aiStub.extract.mockResolvedValueOnce(ask('free_courts'));
    expect(await service.run(session.id, '빈 코트 있어?')).toEqual({
      kind: 'answer',
      title: '빈 코트',
      lines: ['1번 코트가 비어 있어요.', '2번 코트는 다른 모임 차례예요.'],
    });

    aiStub.extract.mockResolvedValueOnce(ask('headcount'));
    const head = await service.run(session.id, '몇 명 왔어?');
    expect(head.kind === 'answer' && head.lines[0]).toBe('출석 5명');

    aiStub.extract.mockResolvedValueOnce(ask('next_game'));
    expect(await service.run(session.id, '다음 게임 누구야?')).toEqual({
      kind: 'answer',
      title: '다음 게임',
      lines: ['김하나, 이두리, 박세나, 최네오'],
    });

    aiStub.extract.mockResolvedValueOnce(ask('other'));
    const other = await service.run(session.id, '오늘 누가 제일 잘 쳐?');
    expect(other.kind).toBe('message');
  });
});

describe('AiCommandService.run — 게스트 추가', () => {
  it('새 게스트는 말한 성별·급수로, 등록된 게스트는 저장값으로, 오늘 온 게스트는 이미 출석, 정회원 동명이인은 안내 — 만들지는 않는다', async () => {
    const session = await seedSession();
    const known = await prisma.member.create({ data: { name: '이영희', grade: 'D', gender: 'FEMALE', isGuest: true } });
    const here = await prisma.member.create({ data: { name: '박손님', grade: 'E', gender: 'MALE', isGuest: true } });
    await prisma.attendance.create({ data: { sessionId: session.id, memberId: here.id } });
    await prisma.member.create({ data: { name: '홍길동', grade: 'B', gender: 'MALE', birthDate: new Date('1990-01-01') } });
    aiStub.extract.mockResolvedValue(
      command({
        action: 'add_guest',
        guests: [
          { name: '홍길동', gender: 'MALE', grade: null },
          { name: '이영희', gender: null, grade: 'A' },
          { name: '박손님', gender: null, grade: null },
        ],
      }),
    );
    const before = await prisma.member.count();

    const result = await service.run(session.id, '게스트 홍길동 남자 이영희 A급 박손님 추가해줘');

    expect(result).toEqual({
      kind: 'guest_preview',
      guests: [
        {
          name: '홍길동',
          gender: 'MALE',
          grade: null,
          existingMemberId: null,
          alreadyCheckedIn: false,
          note: '같은 이름의 정회원이 있어요 — 정회원이면 "이름 체크인"으로 해 주세요',
        },
        { name: '이영희', gender: 'FEMALE', grade: 'D', existingMemberId: known.id, alreadyCheckedIn: false, note: null },
        { name: '박손님', gender: 'MALE', grade: 'E', existingMemberId: here.id, alreadyCheckedIn: true, note: null },
      ],
    });
    expect(await prisma.member.count()).toBe(before); // 미리보기만
  });

  it('이름이 없으면 안내', async () => {
    const session = await seedSession();
    aiStub.extract.mockResolvedValue(command({ action: 'add_guest', guests: [] }));
    const result = await service.run(session.id, '게스트 추가해줘');
    expect(result.kind).toBe('message');
  });
});
