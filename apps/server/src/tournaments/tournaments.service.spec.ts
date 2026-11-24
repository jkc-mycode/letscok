import { BadRequestException, ConflictException } from '@nestjs/common';
import { BracketIssueCode, computeTournamentStandings } from '@letscok/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TournamentsService } from './tournaments.service';

// 대회 만들기와 대진표 등록 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다

const prisma = new PrismaService();
// 바뀔 때마다 다른 화면에 신호를 보내는지 센다 — 소켓 없이 서비스만 조립
let notified = 0;
const realtimeStub = { notifyTournamentChanged: () => void (notified += 1) } as unknown as RealtimeService;
const service = new TournamentsService(prisma, realtimeStub);

const row = (...cells: Array<string | number>) => cells.join('\t');
const NAMES = ['가', '나', '다', '라', '마', '바', '사', '아'];
const BRACKET = [
  row('번호', '라운드', '코트', '종목', '선수1', '선수2', '선수1', '선수2'),
  row(1, 1, 1, '남복', '가', '나', '다', '라'),
  row(2, 1, 2, '여복', '마', '바', '사', '아'),
  row(3, 2, 1, '혼복', '가', '마', '다', '사'),
].join('\n');

async function seedMembers(names: string[] = NAMES) {
  await prisma.member.createMany({ data: names.map((name) => ({ name, grade: 'C' as const })) });
}

const open = () => service.create({ name: '송년 청백전', date: '2026-12-05' });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE tournaments, member_aliases, game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('대회 만들기', () => {
  it('준비 중으로 만들어지고, 진행 전인 대회가 있으면 또 만들 수 없다', async () => {
    const tournament = await open();

    expect(tournament).toMatchObject({ name: '송년 청백전', date: '2026-12-05', status: 'DRAFT', courtCount: 6 });
    expect(tournament).not.toHaveProperty('entryCode');
    await expect(open()).rejects.toBeInstanceOf(ConflictException);
  });

  it('대회가 없으면 current는 null', async () => {
    expect(await service.current()).toBeNull();
  });
});

describe('대진표 붙여 넣기', () => {
  it('미리 보기는 저장하지 않고 팀과 경고를 돌려준다', async () => {
    await seedMembers();
    const { id } = await open();

    const preview = await service.previewBracket(id, { text: BRACKET });

    expect(preview.canImport).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(preview.blueNames).toEqual(['가', '나', '마', '바']);
    expect(preview.whiteNames).toEqual(['다', '라', '사', '아']);
    expect((await service.current())!.matches).toEqual([]);
  });

  it('명단에 없는 이름이 있으면 등록할 수 없다', async () => {
    await seedMembers(NAMES.slice(0, 7));
    const { id } = await open();

    const preview = await service.previewBracket(id, { text: BRACKET });

    expect(preview.canImport).toBe(false);
    expect(preview.issues.map((i) => [i.code, i.name, i.matchNos])).toEqual([[BracketIssueCode.UNKNOWN_NAME, '아', [2]]]);
    await expect(service.importBracket(id, { text: BRACKET })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('같은 이름이 여러 명이면 후보를 알려 주고, 고르면 등록된다', async () => {
    await seedMembers([...NAMES, '가']);
    const { id } = await open();

    const preview = await service.previewBracket(id, { text: BRACKET });
    const issue = preview.issues.find((i) => i.code === BracketIssueCode.AMBIGUOUS_NAME)!;

    expect(preview.canImport).toBe(false);
    expect(issue.candidates).toHaveLength(2);
    const picked = issue.candidates![1].memberId;
    const detail = await service.importBracket(id, { text: BRACKET, picks: [{ name: '가', memberId: picked }] });
    expect(detail.participants.find((p) => p.name === '가')!.memberId).toBe(picked);
  });

  it('별명으로 적힌 이름도 회원과 잇는다', async () => {
    await seedMembers();
    const member = await prisma.member.findFirstOrThrow({ where: { name: '가' } });
    await prisma.memberAlias.create({ data: { alias: '콕콕이', memberId: member.id } });
    const { id } = await open();

    const preview = await service.previewBracket(id, { text: BRACKET.replace(/가/g, '콕콕이') });

    expect(preview.canImport).toBe(true);
  });

  it('등록하면 참가자의 팀, 경기, 선수 자리가 만들어지고 코트 수가 맞춰진다', async () => {
    await seedMembers();
    const { id } = await open();

    const detail = await service.importBracket(id, { text: BRACKET });

    expect(detail.tournament.courtCount).toBe(2);
    expect(detail.participants.map((p) => [p.name, p.team])).toEqual([
      ['가', 'BLUE'],
      ['나', 'BLUE'],
      ['다', 'WHITE'],
      ['라', 'WHITE'],
      ['마', 'BLUE'],
      ['바', 'BLUE'],
      ['사', 'WHITE'],
      ['아', 'WHITE'],
    ]);
    expect(detail.matches.map((m) => [m.matchNo, m.round, m.courtNo, m.type, m.status, m.queueOrder])).toEqual([
      [1, 1, 1, 'MENS', 'QUEUED', 1],
      [2, 1, 2, 'WOMENS', 'QUEUED', 2],
      [3, 2, 1, 'MIXED', 'QUEUED', 3],
    ]);
    expect(detail.matches[2].players.map((p) => [p.slot, p.name])).toEqual([
      [0, '가'],
      [1, '마'],
      [2, '다'],
      [3, '사'],
    ]);
  });

  it('같은 라운드에 두 번 나오는 사람은 경고만 하고 등록된다', async () => {
    await seedMembers();
    const { id } = await open();
    const text = [row(1, 1, 1, '남복', '가', '나', '다', '라'), row(2, 1, 2, '남복', '마', '바', '다', '아')].join('\n');

    const preview = await service.previewBracket(id, { text });

    expect(preview.issues.map((i) => [i.level, i.code, i.name])).toEqual([['WARN', BracketIssueCode.SAME_ROUND_TWICE, '다']]);
    expect((await service.importBracket(id, { text })).matches).toHaveLength(2);
  });

  it('두 팀에 모두 나오는 사람이 있으면 등록할 수 없다', async () => {
    await seedMembers();
    const { id } = await open();
    const text = [row(1, 1, 1, '남복', '가', '나', '다', '라'), row(2, 2, 1, '남복', '다', '바', '사', '아')].join('\n');

    await expect(service.importBracket(id, { text })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('다시 붙여 넣으면 덮어쓰고, 시작한 경기가 있으면 막는다', async () => {
    await seedMembers();
    const { id } = await open();
    await service.importBracket(id, { text: BRACKET });

    const again = await service.importBracket(id, { text: row(9, 1, 1, '남복', '가', '나', '다', '라') });
    expect(again.matches.map((m) => m.matchNo)).toEqual([9]);
    expect(again.participants).toHaveLength(4);

    await prisma.tournamentMatch.updateMany({ where: { tournamentId: id }, data: { status: 'PLAYING' } });
    await expect(service.importBracket(id, { text: BRACKET })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('대회 시작과 경기 진행', () => {
  async function ready() {
    await seedMembers();
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    const matchId = (matchNo: number) => detail.matches.find((m) => m.matchNo === matchNo)!.id;
    return { id, matchId };
  }

  it('대진표가 없으면 시작할 수 없고, 시작하면 진행 중이 된다', async () => {
    const { id } = await open();
    await expect(service.open(id)).rejects.toBeInstanceOf(BadRequestException);

    await seedMembers();
    await service.importBracket(id, { text: BRACKET });
    const detail = await service.open(id);

    expect(detail.tournament.status).toBe('OPEN');
    expect(detail.tournament.openedAt).not.toBeNull();
    await expect(service.open(id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('대회를 시작하기 전에는 경기를 올릴 수 없다', async () => {
    const { id, matchId } = await ready();

    await expect(service.startMatch(id, matchId(1), {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('경기를 시작하면 대진표의 코트에서 진행 중이 되고, 같은 코트에는 또 올릴 수 없다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);

    const detail = await service.startMatch(id, matchId(1), {});

    const first = detail.matches.find((m) => m.matchNo === 1)!;
    expect([first.status, first.courtNo]).toEqual(['PLAYING', 1]);
    expect(first.startedAt).not.toBeNull();
    await expect(service.startMatch(id, matchId(2), { courtNo: 1 })).rejects.toThrow('1코트에서 다른 경기가 진행 중입니다.');
    await expect(service.startMatch(id, matchId(1), {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('다른 코트로 바꿔 시작할 수 있고, 없는 코트 번호는 막는다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);

    await expect(service.startMatch(id, matchId(1), { courtNo: 3 })).rejects.toBeInstanceOf(BadRequestException);
    const detail = await service.startMatch(id, matchId(1), { courtNo: 2 });

    expect(detail.matches.find((m) => m.matchNo === 1)!.courtNo).toBe(2);
  });

  it('선수가 다른 코트에서 경기 중이면 알리고, force로 보내면 시작한다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);
    await service.startMatch(id, matchId(1), {});

    await expect(service.startMatch(id, matchId(3), { courtNo: 2 })).rejects.toMatchObject({
      response: { error: 'PLAYER_BUSY', message: '가 님(1코트), 다 님(1코트)이 아직 경기 중이에요.' },
    });
    const detail = await service.startMatch(id, matchId(3), { courtNo: 2, force: true });

    expect(detail.matches.find((m) => m.matchNo === 3)!.status).toBe('PLAYING');
  });

  it('잘못 올린 경기는 대기로 되돌린다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);
    await service.startMatch(id, matchId(1), {});

    const detail = await service.cancelStart(id, matchId(1));

    const first = detail.matches.find((m) => m.matchNo === 1)!;
    expect([first.status, first.startedAt]).toEqual(['QUEUED', null]);
    await expect(service.cancelStart(id, matchId(1))).rejects.toBeInstanceOf(ConflictException);
  });

  it('진행 중인 경기가 있으면 종료할 수 없고, 종료하면 current에서 빠진다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);
    await service.startMatch(id, matchId(1), {});
    await expect(service.close(id)).rejects.toBeInstanceOf(ConflictException);

    await service.cancelStart(id, matchId(1));
    const closed = await service.close(id);

    expect(closed.status).toBe('CLOSED');
    expect(await service.current()).toBeNull();
  });
});

describe('점수 입력, 수정, 삭제', () => {
  async function playing() {
    await seedMembers();
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    await service.open(id);
    const matchId = (matchNo: number) => detail.matches.find((m) => m.matchNo === matchNo)!.id;
    await service.startMatch(id, matchId(1), {});
    return { id, matchId };
  }
  const scoreOf = (detail: Awaited<ReturnType<typeof service.current>>, matchNo: number) => {
    const match = detail!.matches.find((m) => m.matchNo === matchNo)!;
    return [match.status, match.blueScore, match.whiteScore];
  };

  it('점수를 넣으면 경기가 끝나고 코트가 빈다', async () => {
    const { id, matchId } = await playing();

    const detail = await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 15 });

    expect(scoreOf(detail, 1)).toEqual(['FINISHED', 21, 15]);
    expect(detail.matches.find((m) => m.matchNo === 1)!.endedAt).not.toBeNull();
    expect(scoreOf(await service.startMatch(id, matchId(3), {}), 3)[0]).toBe('PLAYING');
  });

  it('21점 단판 규칙에 맞지 않는 점수는 받지 않는다', async () => {
    const { id, matchId } = await playing();
    const bad = [
      [21, 21],
      [20, 19],
      [0, 0],
    ];

    for (const [blueScore, whiteScore] of bad) {
      await expect(service.setScore(id, matchId(1), { blueScore, whiteScore })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(scoreOf(await service.current(), 1)).toEqual(['PLAYING', null, null]);
  });

  it('끝난 경기의 점수를 고치면 승패가 바뀌고, 끝난 시각은 그대로다', async () => {
    const { id, matchId } = await playing();
    const first = await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 15 });
    const endedAt = first.matches.find((m) => m.matchNo === 1)!.endedAt;

    const detail = await service.setScore(id, matchId(1), { blueScore: 18, whiteScore: 21 });

    expect(scoreOf(detail, 1)).toEqual(['FINISHED', 18, 21]);
    expect(detail.matches.find((m) => m.matchNo === 1)!.endedAt).toBe(endedAt);
  });

  it('코트에 올리지 않은 대기 경기에도 점수를 바로 넣을 수 있다', async () => {
    const { id, matchId } = await playing();

    expect(scoreOf(await service.setScore(id, matchId(2), { blueScore: 0, whiteScore: 21 }), 2)).toEqual(['FINISHED', 0, 21]);
  });

  it('점수를 지우면 대기 경기로 돌아가고, 점수가 없는 경기는 지울 수 없다', async () => {
    const { id, matchId } = await playing();
    await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 15 });

    const detail = await service.clearScore(id, matchId(1));

    const match = detail.matches.find((m) => m.matchNo === 1)!;
    expect([match.status, match.blueScore, match.whiteScore, match.startedAt, match.endedAt]).toEqual(['QUEUED', null, null, null, null]);
    await expect(service.clearScore(id, matchId(1))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('모임원이 보는 대회 현황과 점수판', () => {
  async function started() {
    await seedMembers();
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    const matchId = (matchNo: number) => detail.matches.find((m) => m.matchNo === matchNo)!.id;
    return { id, matchId };
  }

  it('준비 중에는 내보내지 않고, 시작하면 입구 체크인 여부를 뺀 현황을 내보낸다', async () => {
    const { id } = await started();
    await prisma.tournamentParticipant.updateMany({ where: { tournamentId: id }, data: { enteredAt: new Date() } });
    expect(await service.live()).toBeNull();

    await service.open(id);
    const live = (await service.live())!;

    expect(live.matches).toHaveLength(3);
    expect(live.participants.every((p) => p.enteredAt === null)).toBe(true);
    expect(live).not.toHaveProperty('tournament.entryCode');
  });

  it('바뀔 때마다 다른 화면에 신호를 보낸다', async () => {
    const { id, matchId } = await started();
    notified = 0;

    await service.open(id);
    await service.startMatch(id, matchId(1), {});
    await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 10 });
    await service.clearScore(id, matchId(1));

    expect(notified).toBe(4);
  });

  it('점수판은 이긴 경기 수와 득실점, 개인 승수와 경기 수를 센다', async () => {
    const { id, matchId } = await started();
    await service.open(id);
    await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 10 });
    await service.setScore(id, matchId(2), { blueScore: 15, whiteScore: 21 });

    const standings = computeTournamentStandings(await service.setScore(id, matchId(3), { blueScore: 21, whiteScore: 19 }));

    expect(standings.blue).toEqual({ wins: 2, pointsFor: 57, pointsAgainst: 50 });
    expect(standings.white).toEqual({ wins: 1, pointsFor: 50, pointsAgainst: 57 });
    expect([standings.leader, standings.finished, standings.total]).toEqual(['BLUE', 3, 3]);
    expect(standings.players.map((p) => [p.name, p.wins, p.games])).toEqual([
      ['가', 2, 2],
      ['나', 1, 1],
      ['아', 1, 1],
      ['마', 1, 2],
      ['사', 1, 2],
      ['라', 0, 1],
      ['바', 0, 1],
      ['다', 0, 2],
    ]);
  });

  it('승수가 같으면 득실점 차이로 가리고, 그것도 같으면 동률', async () => {
    const { id, matchId } = await started();
    await service.open(id);
    await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 10 });
    const ahead = computeTournamentStandings(await service.setScore(id, matchId(2), { blueScore: 15, whiteScore: 21 }));
    const even = computeTournamentStandings(await service.setScore(id, matchId(2), { blueScore: 10, whiteScore: 21 }));

    expect(ahead.leader).toBe('BLUE');
    expect(even.leader).toBeNull();
  });

  it('한 팀에만 대리가 있으면 실제 점수와 상관없이 그 팀의 0:21 패배이고, 개인 기록에서 뺀다', async () => {
    const { id, matchId } = await started();
    await service.open(id);
    const proxy = await prisma.member.findFirstOrThrow({ where: { name: '아' } });
    await prisma.tournamentMatchPlayer.updateMany({ where: { matchId: matchId(1), slot: 2 }, data: { proxyMemberId: proxy.id } });

    const standings = computeTournamentStandings(await service.setScore(id, matchId(1), { blueScore: 12, whiteScore: 21 }));

    expect(standings.blue).toEqual({ wins: 1, pointsFor: 21, pointsAgainst: 0 });
    expect(standings.white).toEqual({ wins: 0, pointsFor: 0, pointsAgainst: 21 });
    expect(standings.players.every((p) => p.games === 0 && p.wins === 0)).toBe(true);
  });
});
