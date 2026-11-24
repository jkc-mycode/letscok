import {
  BracketIssueCode,
  BracketIssueLevel,
  IBracketIssue,
  IBracketRow,
  TournamentMatchType,
} from '@letscok/shared-types';

// 시트 대진표(번호·라운드·코트·종목·청팀 2명·백팀 2명)를 붙여 넣은 글자를 경기 목록으로 읽는다
// 제목 줄·빈 줄은 건너뛰고, 스코어·승리 팀 칸(9번째 칸부터)은 무시한다
const COLUMNS = 8;

const firstInt = (cell: string | undefined): number | null => {
  const found = cell?.match(/\d+/);
  return found ? Number(found[0]) : null;
};

function toMatchType(cell: string): TournamentMatchType | null {
  if (cell.includes('혼')) return TournamentMatchType.MIXED;
  if (cell.includes('남')) return TournamentMatchType.MENS;
  if (cell.includes('여')) return TournamentMatchType.WOMENS;
  return null;
}

export function parseBracket(text: string): { rows: IBracketRow[]; issues: IBracketIssue[] } {
  const rows: IBracketRow[] = [];
  const issues: IBracketIssue[] = [];
  const seenMatchNos = new Set<number>();
  let lastRound: number | null = null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const cells = raw.split('\t').map((cell) => cell.trim());
    const matchNo = firstInt(cells[0]);
    // 번호 칸에 숫자가 없으면 제목 줄이나 빈 줄
    if (matchNo === null) return;

    const bad = (reason: string) =>
      issues.push({
        level: BracketIssueLevel.ERROR,
        code: BracketIssueCode.BAD_ROW,
        message: `${line}번째 줄(${matchNo}번 경기): ${reason}`,
        line,
        matchNos: [matchNo],
      });

    if (cells.length < COLUMNS) {
      bad('칸이 모자라요. 번호부터 백팀 선수2까지 8칸을 복사해 주세요.');
      return;
    }
    // 라운드 칸을 합쳐 둔 시트는 첫 줄에만 값이 있다 — 비어 있으면 윗줄의 라운드를 따른다
    const round = firstInt(cells[1]) ?? lastRound;
    const courtNo = firstInt(cells[2]);
    const type = toMatchType(cells[3]);
    const names = cells.slice(4, COLUMNS);
    if (round === null) return void bad('라운드를 읽을 수 없어요.');
    lastRound = round;
    if (courtNo === null || courtNo < 1) return void bad('코트 번호를 읽을 수 없어요.');
    if (!type) return void bad('종목은 남복, 여복, 혼복 중 하나여야 해요.');
    if (names.some((name) => !name)) return void bad('선수 이름이 비어 있어요.');
    if (seenMatchNos.has(matchNo)) {
      issues.push({
        level: BracketIssueLevel.ERROR,
        code: BracketIssueCode.DUPLICATE_MATCH_NO,
        message: `${matchNo}번 경기가 두 번 나와요.`,
        line,
        matchNos: [matchNo],
      });
      return;
    }
    seenMatchNos.add(matchNo);
    rows.push({ matchNo, round, courtNo, type, blue: [names[0], names[1]], white: [names[2], names[3]] });
  });

  return { rows, issues };
}

// 사람 기준 검사 — keyOf가 같은 값을 내면 같은 사람으로 본다(회원을 찾았으면 회원 id, 못 찾았으면 이름)
export function checkBracketPeople(rows: IBracketRow[], keyOf: (name: string) => string): IBracketIssue[] {
  const issues: IBracketIssue[] = [];
  const people = new Map<string, { name: string; blue: number[]; white: number[]; byRound: Map<number, number[]> }>();

  for (const row of rows) {
    const inMatch = new Set<string>();
    const sides: Array<['blue' | 'white', string]> = [
      ['blue', row.blue[0]],
      ['blue', row.blue[1]],
      ['white', row.white[0]],
      ['white', row.white[1]],
    ];
    for (const [side, name] of sides) {
      const key = keyOf(name);
      if (inMatch.has(key)) {
        issues.push({
          level: BracketIssueLevel.ERROR,
          code: BracketIssueCode.SAME_PLAYER_IN_MATCH,
          message: `${row.matchNo}번 경기에 ${name} 님이 두 번 들어가 있어요.`,
          matchNos: [row.matchNo],
          name,
        });
        continue;
      }
      inMatch.add(key);
      const person = people.get(key) ?? { name, blue: [], white: [], byRound: new Map<number, number[]>() };
      person[side].push(row.matchNo);
      person.byRound.set(row.round, [...(person.byRound.get(row.round) ?? []), row.matchNo]);
      people.set(key, person);
    }
  }

  for (const person of people.values()) {
    if (person.blue.length && person.white.length) {
      issues.push({
        level: BracketIssueLevel.ERROR,
        code: BracketIssueCode.BOTH_TEAMS,
        message: `${person.name} 님이 청팀(${person.blue.join(', ')}번)과 백팀(${person.white.join(', ')}번)에 모두 나와요.`,
        matchNos: [...person.blue, ...person.white],
        name: person.name,
      });
    }
    for (const [round, matchNos] of person.byRound) {
      if (matchNos.length < 2) continue;
      issues.push({
        level: BracketIssueLevel.WARN,
        code: BracketIssueCode.SAME_ROUND_TWICE,
        message: `${person.name} 님이 ${round}라운드에 두 번 나와요(${matchNos.join(', ')}번).`,
        matchNos,
        name: person.name,
      });
    }
  }
  return issues;
}
