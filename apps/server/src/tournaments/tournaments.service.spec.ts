import { BadRequestException, ConflictException } from '@nestjs/common';
import { BracketIssueCode } from '@letscok/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentsService } from './tournaments.service';

// 대회 만들기와 대진표 등록 통합 테스트 — 실제 Prisma+테스트 DB로 검증한다

const prisma = new PrismaService();
const service = new TournamentsService(prisma);

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
