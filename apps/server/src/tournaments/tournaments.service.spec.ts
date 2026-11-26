import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BracketIssueCode, computeTournamentStandings, TournamentTeam } from '@letscok/shared-types';
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

  it('다시 붙여 넣어도 입구 체크인 기록은 남고, 팀이 바뀐 사람은 팀만 고친다', async () => {
    await seedMembers();
    const { id } = await open();
    const first = await service.importBracket(id, { text: BRACKET });
    const byName = (name: string) => first.participants.find((p) => p.name === name)!;
    await service.setEntry(id, byName('가').id, true);
    await service.setEntry(id, byName('마').id, true);

    // 가는 청팀에서 백팀으로 옮기고, 마와 바와 사와 아는 새 대진표에서 빠진다
    const again = await service.importBracket(id, { text: row(1, 1, 1, '남복', '다', '라', '가', '나') });
    const moved = again.participants.find((p) => p.name === '가')!;
    expect(moved.id).toBe(byName('가').id);
    expect(moved.team).toBe(TournamentTeam.WHITE);
    expect(moved.enteredAt).not.toBeNull();
    // 체크인한 마는 대진표에 없어도 남고, 체크인하지 않은 나머지는 빠진다
    expect(again.participants.map((p) => p.name).sort()).toEqual(['가', '나', '다', '라', '마']);
    expect(again.participants.find((p) => p.name === '마')!.enteredAt).not.toBeNull();
    expect(again.matches[0].players.map((player) => player.name)).toEqual(['다', '라', '가', '나']);
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

  it('두 경기를 같은 코트에 동시에 올려도 하나만 시작된다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);
    const results = await Promise.allSettled([
      service.startMatch(id, matchId(1), { courtNo: 1 }),
      service.startMatch(id, matchId(2), { courtNo: 1 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const playing = await prisma.tournamentMatch.count({ where: { tournamentId: id, status: 'PLAYING' } });
    expect(playing).toBe(1);
  });

  it('종료와 경기 시작이 동시에 들어와도 끝난 대회에 진행 중인 경기가 남지 않는다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);
    await Promise.allSettled([service.close(id), service.startMatch(id, matchId(1), {})]);
    const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id } });
    const playing = await prisma.tournamentMatch.count({ where: { tournamentId: id, status: 'PLAYING' } });
    expect(tournament.status === 'CLOSED' && playing > 0).toBe(false);
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

  it('진행 중인 경기가 있으면 종료할 수 없고, 종료하면 결과를 내릴 때까지 최종 결과로 남는다', async () => {
    const { id, matchId } = await ready();
    await service.open(id);
    await service.startMatch(id, matchId(1), {});
    await expect(service.close(id)).rejects.toBeInstanceOf(ConflictException);

    await service.cancelStart(id, matchId(1));
    const closed = await service.close(id);

    expect(closed.tournament.status).toBe('CLOSED');
    expect((await service.current())!.tournament.id).toBe(id);
    const live = (await service.live())!;
    expect([live.tournament.status, live.matches.length]).toEqual(['CLOSED', 3]);
    // 끝난 대회는 더 고칠 수 없다
    await expect(service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 10 })).rejects.toBeInstanceOf(ConflictException);

    await service.hideResult(id);

    expect(await service.current()).toBeNull();
    expect(await service.live()).toBeNull();
    await expect(service.hideResult(id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('진행 중인 대회의 결과는 내릴 수 없고, 새 대회를 만들면 지난 결과가 내려간다', async () => {
    const { id } = await ready();
    await service.open(id);
    await expect(service.hideResult(id)).rejects.toBeInstanceOf(ConflictException);
    await service.close(id);

    const next = await service.create({ name: '다음 대회', date: '2027-12-04' });

    expect((await service.current())!.tournament.id).toBe(next.id);
    expect(await service.live()).toBeNull();
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

describe('입구 체크인', () => {
  it('준비 중에도 체크인하고, 되돌릴 수 있고, 처음 누른 시각이 유지된다', async () => {
    await seedMembers();
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    const target = detail.participants.find((p) => p.name === '가')!;

    const entered = await service.setEntry(id, target.id, true);
    const firstAt = entered.participants.find((p) => p.id === target.id)!.enteredAt;
    const again = await service.setEntry(id, target.id, true);

    expect(firstAt).not.toBeNull();
    expect(again.participants.find((p) => p.id === target.id)!.enteredAt).toBe(firstAt);
    expect(again.participants.filter((p) => p.enteredAt !== null)).toHaveLength(1);

    const undone = await service.setEntry(id, target.id, false);
    expect(undone.participants.every((p) => p.enteredAt === null)).toBe(true);
  });

  it('다른 대회의 참가자나 없는 참가자는 404', async () => {
    await seedMembers();
    const { id } = await open();
    await service.importBracket(id, { text: BRACKET });

    await expect(service.setEntry(id, 'nope', true)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('추첨 번호와 상품', () => {
  async function ready() {
    await seedMembers();
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    const who = (name: string) => detail.participants.find((p) => p.name === name)!.id;
    return { id, who };
  }
  const numbers = (detail: Awaited<ReturnType<typeof service.current>>) =>
    Object.fromEntries(detail!.participants.filter((p) => p.raffleNo !== null).map((p) => [p.name, p.raffleNo]));

  it('체크인한 순서대로 번호를 매기고, 되돌리면 비우고, 다음 사람은 가장 큰 번호의 다음을 받는다', async () => {
    const { id, who } = await ready();

    await service.setEntry(id, who('다'), true);
    await service.setEntry(id, who('가'), true);
    await service.setEntry(id, who('나'), true);
    expect(numbers(await service.setEntry(id, who('가'), false))).toEqual({ 다: 1, 나: 3 });
    expect(numbers(await service.setEntry(id, who('가'), true))).toEqual({ 다: 1, 나: 3, 가: 4 });
  });

  it('번호를 고치면 그 번호를 가진 사람과 맞바꾸고, 체크인하지 않은 사람은 번호를 가질 수 없다', async () => {
    const { id, who } = await ready();
    await service.setEntry(id, who('가'), true);
    await service.setEntry(id, who('나'), true);

    expect(numbers(await service.setRaffleNo(id, who('가'), 2))).toEqual({ 가: 2, 나: 1 });
    expect(numbers(await service.setRaffleNo(id, who('가'), 30))).toEqual({ 가: 30, 나: 1 });
    await expect(service.setRaffleNo(id, who('다'), 5)).rejects.toBeInstanceOf(ConflictException);
  });

  it('상품을 등록하고 당첨 번호를 적으면 그 번호의 참가자가 당첨자로 남는다', async () => {
    const { id, who } = await ready();
    await service.setEntry(id, who('가'), true);
    await service.setEntry(id, who('나'), true);

    const added = await service.addPrizes(id, { names: [' 라켓 ', '', '셔틀콕 한 통'] });
    expect(added.prizes.map((p) => [p.name, p.winnerName])).toEqual([
      ['라켓', null],
      ['셔틀콕 한 통', null],
    ]);
    const [racket, shuttle] = added.prizes;

    const drawn = await service.setPrizeWinner(id, racket.id, 2);
    expect(drawn.prizes[0]).toMatchObject({ raffleNo: 2, winnerName: '나', participantId: who('나') });
    await expect(service.setPrizeWinner(id, shuttle.id, 9)).rejects.toBeInstanceOf(NotFoundException);

    // 당첨을 기록한 뒤 번호를 고쳐도 당첨자는 그대로
    const swapped = await service.setRaffleNo(id, who('가'), 2);
    expect(swapped.prizes[0]).toMatchObject({ raffleNo: 2, winnerName: '나' });

    await expect(service.removePrize(id, racket.id)).rejects.toBeInstanceOf(ConflictException);
    const cleared = await service.clearPrizeWinner(id, racket.id);
    expect(cleared.prizes[0]).toMatchObject({ raffleNo: null, winnerName: null });
    expect((await service.removePrize(id, racket.id)).prizes.map((p) => p.name)).toEqual(['셔틀콕 한 통']);
  });

  it('끝난 대회도 결과를 띄워 둔 동안은 당첨을 기록할 수 있고, 공개 현황에는 추첨 기록이 실리지 않는다', async () => {
    const { id, who } = await ready();
    await service.open(id);
    await service.setEntry(id, who('가'), true);
    const [prize] = (await service.addPrizes(id, { names: ['라켓'] })).prizes;
    await service.close(id);

    const drawn = await service.setPrizeWinner(id, prize.id, 1);
    expect(drawn.prizes[0].winnerName).toBe('가');
    const live = await service.live();
    expect(live!.prizes).toEqual([]);
    expect(live!.participants.every((p) => p.raffleNo === null)).toBe(true);

    await service.hideResult(id);
    await expect(service.clearPrizeWinner(id, prize.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('대기 경기 순서 바꾸기와 선수 바꾸기', () => {
  // 1라운드: 1번(가 나 : 다 라) 2번(마 바 : 사 아) / 2라운드: 3번(가 마 : 다 사)
  async function ready() {
    await seedMembers();
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    const matchId = (matchNo: number) => detail.matches.find((m) => m.matchNo === matchNo)!.id;
    const who = (name: string) => detail.participants.find((p) => p.name === name)!.id;
    return { id, matchId, who };
  }
  const namesOf = (detail: Awaited<ReturnType<typeof service.current>>, matchNo: number) =>
    detail!.matches.find((m) => m.matchNo === matchNo)!.players.map((p) => p.name);

  it('대기 경기 순서를 바꾸면 그 순서대로 1부터 다시 매긴다', async () => {
    const { id, matchId } = await ready();

    const detail = await service.reorderQueue(id, [matchId(3), matchId(1), matchId(2)]);

    expect(detail.matches.map((m) => [m.matchNo, m.queueOrder])).toEqual([
      [1, 2],
      [2, 3],
      [3, 1],
    ]);
  });

  it('대기 경기 전부를 보내지 않았거나 대기가 아닌 경기가 섞이면 순서를 바꾸지 않는다', async () => {
    const { id, matchId } = await ready();
    await expect(service.reorderQueue(id, [matchId(3), matchId(1)])).rejects.toBeInstanceOf(ConflictException);

    await service.open(id);
    await service.startMatch(id, matchId(1), {});
    await expect(service.reorderQueue(id, [matchId(3), matchId(1), matchId(2)])).rejects.toBeInstanceOf(ConflictException);
    expect((await service.reorderQueue(id, [matchId(3), matchId(2)])).matches.map((m) => m.queueOrder)).toEqual([1, 2, 1]);
  });

  it('같은 팀의 다른 사람으로 바꾼다', async () => {
    const { id, matchId, who } = await ready();

    const detail = await service.replacePlayer(id, matchId(3), 0, { participantId: who('나') });

    expect(namesOf(detail, 3)).toEqual(['나', '마', '다', '사']);
  });

  it('다른 팀 사람이나 이미 그 경기에 있는 사람으로는 바꿀 수 없다', async () => {
    const { id, matchId, who } = await ready();

    await expect(service.replacePlayer(id, matchId(3), 0, { participantId: who('라') })).rejects.toThrow('같은 팀의 사람으로만');
    await expect(service.replacePlayer(id, matchId(3), 0, { participantId: who('마') })).rejects.toThrow('이미 이 경기에 있는');
  });

  it('바꾼 사람이 같은 라운드에 이미 있으면 알리고, force로 보내면 바꾼다', async () => {
    const { id, matchId, who } = await ready();

    await expect(service.replacePlayer(id, matchId(1), 1, { participantId: who('마') })).rejects.toMatchObject({
      response: { error: 'PLAYER_BUSY', message: '마 님이 1라운드에 이미 있어요(2번).' },
    });
    const detail = await service.replacePlayer(id, matchId(1), 1, { participantId: who('마'), force: true });

    expect(namesOf(detail, 1)).toEqual(['가', '마', '다', '라']);
  });

  it('맞바꾸면 두 경기의 사람이 서로 자리를 바꾸고, 같은 라운드 겹침이 생기지 않으면 경고도 없다', async () => {
    const { id, matchId, who } = await ready();

    const detail = await service.replacePlayer(id, matchId(1), 1, { participantId: who('바'), swapMatchId: matchId(2) });

    expect(namesOf(detail, 1)).toEqual(['가', '바', '다', '라']);
    expect(namesOf(detail, 2)).toEqual(['마', '나', '사', '아']);
  });

  it('맞바꾸면 한 경기에 같은 사람이 두 번 들어가는 경우는 막는다', async () => {
    const { id, matchId, who } = await ready();

    // 1번의 가 ↔ 3번의 마: 3번에는 가가 이미 있다
    await expect(service.replacePlayer(id, matchId(1), 0, { participantId: who('마'), swapMatchId: matchId(3) })).rejects.toThrow(
      '한 경기에 같은 사람이 두 번',
    );
  });

  it('맞바꾼 결과로 나간 사람이 그 라운드에 두 번 나오면 알린다', async () => {
    const { id, matchId, who } = await ready();

    // 3번(2라운드)의 마 ↔ 1번(1라운드)의 나: 마는 1라운드 2번에 이미 있다
    await expect(service.replacePlayer(id, matchId(3), 1, { participantId: who('나'), swapMatchId: matchId(1) })).rejects.toMatchObject({
      response: { error: 'PLAYER_BUSY', message: '마 님이 1라운드에 이미 있어요(2번).' },
    });
    const detail = await service.replacePlayer(id, matchId(3), 1, { participantId: who('나'), swapMatchId: matchId(1), force: true });

    expect(namesOf(detail, 3)).toEqual(['가', '나', '다', '사']);
    expect(namesOf(detail, 1)).toEqual(['가', '마', '다', '라']);
  });

  it('끝난 경기의 선수는 바꿀 수 없다', async () => {
    const { id, matchId, who } = await ready();
    await service.open(id);
    await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 3 });

    await expect(service.replacePlayer(id, matchId(1), 1, { participantId: who('바') })).rejects.toBeInstanceOf(ConflictException);
  });

  it('진행 중인 경기에 넣는 사람이 다른 코트에서 경기 중이면 알린다', async () => {
    const { id, matchId, who } = await ready();
    await service.open(id);
    await service.startMatch(id, matchId(1), {});
    await service.startMatch(id, matchId(3), { courtNo: 2, force: true });

    await expect(service.replacePlayer(id, matchId(3), 1, { participantId: who('나') })).rejects.toMatchObject({
      response: { error: 'PLAYER_BUSY', message: '나 님이 1코트에서 경기 중이에요.' },
    });
  });
});

describe('참가자 추가', () => {
  async function ready() {
    await seedMembers([...NAMES, '대타']);
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    const matchId = (matchNo: number) => detail.matches.find((m) => m.matchNo === matchNo)!.id;
    const memberId = async (name: string) => (await prisma.member.findFirstOrThrow({ where: { name } })).id;
    return { id, matchId, memberId };
  }

  it('대진표에 없는 회원을 팀을 정해 추가하면 선수 바꾸기로 경기에 넣을 수 있다', async () => {
    const { id, matchId, memberId } = await ready();

    const added = await service.addParticipant(id, { memberId: await memberId('대타'), team: TournamentTeam.BLUE });
    const sub = added.participants.find((p) => p.name === '대타')!;
    const detail = await service.replacePlayer(id, matchId(1), 0, { participantId: sub.id });

    expect(sub.team).toBe('BLUE');
    expect(detail.matches[0].players.map((p) => p.name)).toEqual(['대타', '나', '다', '라']);
  });

  it('이미 참가자인 사람과 없는 회원은 추가할 수 없다', async () => {
    const { id, memberId } = await ready();

    await expect(service.addParticipant(id, { memberId: await memberId('가'), team: TournamentTeam.WHITE })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.addParticipant(id, { memberId: 'none', team: TournamentTeam.BLUE })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('경기에 없는 참가자만 뺄 수 있다', async () => {
    const { id, memberId } = await ready();
    const added = await service.addParticipant(id, { memberId: await memberId('대타'), team: TournamentTeam.WHITE });
    const idOf = (name: string) => added.participants.find((p) => p.name === name)!.id;

    await expect(service.removeParticipant(id, idOf('가'))).rejects.toBeInstanceOf(ConflictException);
    const detail = await service.removeParticipant(id, idOf('대타'));

    expect(detail.participants.map((p) => p.name)).not.toContain('대타');
  });
});

describe('지각 대리 경기', () => {
  async function ready() {
    await seedMembers([...NAMES, '운영']);
    const { id } = await open();
    const detail = await service.importBracket(id, { text: BRACKET });
    await service.open(id);
    const matchId = (matchNo: number) => detail.matches.find((m) => m.matchNo === matchNo)!.id;
    const memberId = async (name: string) => (await prisma.member.findFirstOrThrow({ where: { name } })).id;
    return { id, matchId, memberId };
  }
  const proxiesOf = (detail: Awaited<ReturnType<typeof service.current>>, matchNo: number) =>
    detail!.matches.find((m) => m.matchNo === matchNo)!.players.map((p) => p.proxyName);

  it('대리를 넣으면 선수 이름은 그대로 두고 대신 뛴 사람만 적고, 지우면 사라진다', async () => {
    const { id, matchId, memberId } = await ready();

    const detail = await service.setProxy(id, matchId(1), 1, await memberId('운영'));

    expect(detail.matches[0].players.map((p) => p.name)).toEqual(['가', '나', '다', '라']);
    expect(proxiesOf(detail, 1)).toEqual([null, '운영', null, null]);
    expect(proxiesOf(await service.setProxy(id, matchId(1), 1, null), 1)).toEqual([null, null, null, null]);
  });

  it('대리가 있는 팀은 실제 점수와 상관없이 0:21로 지고, 그 경기는 개인 순위에서 빠진다', async () => {
    const { id, matchId, memberId } = await ready();
    await service.setProxy(id, matchId(1), 1, await memberId('운영'));

    const standings = computeTournamentStandings(await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 15 }));

    expect(standings.blue).toMatchObject({ wins: 0, pointsFor: 0, pointsAgainst: 21 });
    expect(standings.white).toMatchObject({ wins: 1, pointsFor: 21, pointsAgainst: 0 });
    expect(standings.players.every((player) => player.games === 0)).toBe(true);
  });

  it('점수를 넣은 뒤에도 대리 표시를 고칠 수 있다', async () => {
    const { id, matchId, memberId } = await ready();
    await service.setScore(id, matchId(1), { blueScore: 21, whiteScore: 15 });

    const standings = computeTournamentStandings(await service.setProxy(id, matchId(1), 0, await memberId('운영')));

    expect(standings.white.wins).toBe(1);
  });

  it('그 경기에 이미 있는 사람이나 없는 회원, 게스트는 대리로 넣을 수 없다', async () => {
    const { id, matchId, memberId } = await ready();
    const guest = await prisma.member.create({ data: { name: '손님', grade: 'C', isGuest: true } });

    await expect(service.setProxy(id, matchId(1), 1, await memberId('나'))).rejects.toThrow('이미 이 경기에 있는');
    await expect(service.setProxy(id, matchId(1), 1, await memberId('다'))).rejects.toThrow('이미 이 경기에 있는');
    await service.setProxy(id, matchId(1), 0, await memberId('운영'));
    await expect(service.setProxy(id, matchId(1), 1, await memberId('운영'))).rejects.toThrow('이미 이 경기에 있는');
    await expect(service.setProxy(id, matchId(1), 1, 'none')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setProxy(id, matchId(1), 1, guest.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('다른 경기에 나오는 참가자도 대리로 뛸 수 있다', async () => {
    const { id, matchId, memberId } = await ready();

    const detail = await service.setProxy(id, matchId(1), 1, await memberId('마'));

    expect(proxiesOf(detail, 1)).toEqual([null, '마', null, null]);
  });
});
