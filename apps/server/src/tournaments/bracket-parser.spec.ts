import { BracketIssueCode } from '@letscok/shared-types';
import { checkBracketPeople, parseBracket } from './bracket-parser';

const row = (...cells: Array<string | number>) => cells.join('\t');
const same = (name: string) => name;

describe('parseBracket', () => {
  it('제목 줄과 빈 줄을 건너뛰고, 스코어·승리 팀 칸은 무시한다', () => {
    const text = [
      row('번호', '라운드', '코트', '종목', '선수1', '선수2', '선수1', '선수2', '청팀', ':', '백팀', '승리 팀'),
      '',
      row(1, '1R', '1코트', '남복', '가', '나', '다', '라', 21, ':', 15, '청팀'),
      row(2, 1, 2, '혼복', '마', '바', '사', '아'),
    ].join('\r\n');

    const { rows, issues } = parseBracket(text);

    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { matchNo: 1, round: 1, courtNo: 1, type: 'MENS', blue: ['가', '나'], white: ['다', '라'] },
      { matchNo: 2, round: 1, courtNo: 2, type: 'MIXED', blue: ['마', '바'], white: ['사', '아'] },
    ]);
  });

  it('라운드 칸이 비어 있으면 윗줄의 라운드를 따른다 (합친 칸)', () => {
    const text = [row(1, 2, 1, '여복', '가', '나', '다', '라'), row(2, '', 2, '여복', '마', '바', '사', '아')].join('\n');

    expect(parseBracket(text).rows.map((r) => r.round)).toEqual([2, 2]);
  });

  it('칸이 모자라거나 종목·이름을 읽을 수 없으면 그 줄을 오류로 알린다', () => {
    const text = [
      row(1, 1, 1, '남복', '가', '나', '다'),
      row(2, 1, 2, '단식', '가', '나', '다', '라'),
      row(3, 1, 3, '남복', '가', '', '다', '라'),
      row(4, 1, 4, '남복', '가', '나', '다', '라'),
      row(4, 1, 5, '남복', '마', '바', '사', '아'),
    ].join('\n');

    const { rows, issues } = parseBracket(text);

    expect(rows.map((r) => r.matchNo)).toEqual([4]);
    expect(issues.map((i) => [i.code, i.line])).toEqual([
      [BracketIssueCode.BAD_ROW, 1],
      [BracketIssueCode.BAD_ROW, 2],
      [BracketIssueCode.BAD_ROW, 3],
      [BracketIssueCode.DUPLICATE_MATCH_NO, 5],
    ]);
  });
});

describe('checkBracketPeople', () => {
  const parse = (lines: string[]) => parseBracket(lines.join('\n')).rows;

  it('같은 라운드에 두 번 나오면 경고, 두 팀에 모두 나오면 오류', () => {
    const rows = parse([
      row(1, 1, 1, '남복', '가', '나', '다', '라'),
      row(2, 1, 2, '남복', '마', '바', '다', '사'),
      row(3, 2, 1, '남복', '라', '나', '아', '자'),
    ]);

    const issues = checkBracketPeople(rows, same);

    expect(issues.map((i) => [i.level, i.code, i.name])).toEqual([
      ['WARN', BracketIssueCode.SAME_ROUND_TWICE, '다'],
      ['ERROR', BracketIssueCode.BOTH_TEAMS, '라'],
    ]);
  });

  it('한 경기에 같은 사람이 두 번 들어가면 오류', () => {
    const rows = parse([row(1, 1, 1, '남복', '가', '가', '다', '라')]);

    expect(checkBracketPeople(rows, same).map((i) => i.code)).toEqual([BracketIssueCode.SAME_PLAYER_IN_MATCH]);
  });

  it('문제가 없으면 빈 목록', () => {
    const rows = parse([row(1, 1, 1, '남복', '가', '나', '다', '라'), row(2, 2, 1, '남복', '가', '나', '다', '라')]);

    expect(checkBracketPeople(rows, same)).toEqual([]);
  });
});
