// 뒤풀이 정산 계산 — 금액을 공통(전원)·술(술 마신 사람)·음료(음료 마신 사람) 세 묶음으로 나눠 각자 해당 묶음만 낸다
// 그룹은 배열로 받는다 — 나중에 "2차만 참석" 같은 그룹이 생겨도 표시 조합만 추가하면 된다

export interface SettlementGroup {
  key: string;
  label: string;
  phrase: string; // 카톡 문구용 — "음료만 마신 사람"
  alcohol: boolean; // 술값을 나눠 내는지
  beverage: boolean; // 음료값을 나눠 내는지
  count: number;
  names: string[]; // 카톡 문구에 적을 이름(선택) — 있으면 인원수는 이름 수를 따른다
}

export interface SettlementInput {
  total: number;
  alcohol: number;
  beverage: number;
  sponsor?: number; // 찬조(원) — 공통·술·음료를 같은 비율로 줄인다(50%면 모두의 몫이 절반)
  groups: SettlementGroup[];
}

export interface SettlementShare {
  group: SettlementGroup;
  perPerson: number; // 원 단위 내림
}

export type SettlementResult =
  | {
      ok: true;
      common: number; // 총액 − 술값 − 음료값
      headcount: number;
      collectTotal: number; // 걷을 금액 = 총액 − 찬조
      shares: SettlementShare[]; // 인원 0명인 그룹은 뺀다
      remainder: number; // 내림으로 남은 몇 원 — 결제자 부담
    }
  | { ok: false; error: string };

export const DEFAULT_GROUPS: SettlementGroup[] = [
  { key: 'both', label: '술+음료', phrase: '술과 음료 마신 사람', alcohol: true, beverage: true, count: 0, names: [] },
  { key: 'alcohol', label: '술만', phrase: '주류만 마신 사람', alcohol: true, beverage: false, count: 0, names: [] },
  { key: 'beverage', label: '음료만', phrase: '음료만 마신 사람', alcohol: false, beverage: true, count: 0, names: [] },
  { key: 'none', label: '안 마심', phrase: '아무것도 안 마신 사람', alcohol: false, beverage: false, count: 0, names: [] },
];

const isWon = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function settle({ total, alcohol, beverage, sponsor = 0, groups }: SettlementInput): SettlementResult {
  if (![total, alcohol, beverage, sponsor].every(isWon) || !groups.every((g) => isWon(g.count))) {
    return { ok: false, error: '금액과 인원은 0 이상의 정수로 입력해주세요' };
  }
  const headcount = groups.reduce((sum, g) => sum + g.count, 0);
  const alcoholCount = groups.reduce((sum, g) => sum + (g.alcohol ? g.count : 0), 0);
  const beverageCount = groups.reduce((sum, g) => sum + (g.beverage ? g.count : 0), 0);

  if (total === 0) return { ok: false, error: '총 금액을 입력해주세요' };
  if (headcount === 0) return { ok: false, error: '인원을 입력해주세요' };
  if (alcohol + beverage > total) return { ok: false, error: '술값과 음료값의 합이 총액보다 커요' };
  if (sponsor > total) return { ok: false, error: '찬조 금액이 총액보다 커요' };
  if (alcohol > 0 && alcoholCount === 0) return { ok: false, error: '술값이 있는데 술 마신 사람이 없어요' };
  if (beverage > 0 && beverageCount === 0) return { ok: false, error: '음료값이 있는데 음료 마신 사람이 없어요' };

  const common = total - alcohol - beverage;
  const collectTotal = total - sponsor;
  // 정수 연산으로 한 번에 내림 — 소수로 더하면 27133.333…처럼 나눠떨어지는 경우에도 1원 어긋날 수 있다
  // 찬조 비율(collectTotal / total)까지 곱하면 Number 범위를 넘을 수 있어 BigInt로 계산한다
  const a = BigInt(alcoholCount || 1);
  const b = BigInt(beverageCount || 1);
  const n = BigInt(headcount);
  const denominator = n * a * b * BigInt(total);
  const shares = groups
    .filter((g) => g.count > 0)
    .map((group) => {
      const numerator =
        BigInt(common) * a * b +
        (group.alcohol ? BigInt(alcohol) * n * b : BigInt(0)) +
        (group.beverage ? BigInt(beverage) * n * a : BigInt(0));
      return { group, perPerson: Number((numerator * BigInt(collectTotal)) / denominator) };
    });
  const collected = shares.reduce((sum, s) => sum + s.perPerson * s.group.count, 0);
  return { ok: true, common, headcount, collectTotal, shares, remainder: collectTotal - collected };
}

// ===== 사람별 정산 — 개인 메뉴(먹은 사람만 내는 품목)가 있을 때 =====
// 공통 ÷ 전원 + 술 ÷ 술 마신 사람 + 음료 ÷ 음료 마신 사람 + 자기가 먹은 개인 메뉴(여럿이 먹었으면 똑같이 나눔)
// 사람은 그룹 이름 칸에 적은 이름 — 술·음료 여부는 그 사람이 든 그룹을 따른다

export interface PersonalItem {
  amount: number;
  eaters: string[]; // 먹은 사람 이름
}

export interface PersonShare {
  name: string;
  group: SettlementGroup;
  perPerson: number; // 원 단위 내림
}

export type PeopleSettlementResult =
  | {
      ok: true;
      common: number; // 총액 − 술 − 음료 − 개인 메뉴
      headcount: number;
      collectTotal: number;
      people: PersonShare[]; // 낼 돈이 많은 순
      remainder: number; // 내림으로 남은 몇 원 — 결제자 부담
    }
  | { ok: false; error: string };

const gcd = (a: bigint, b: bigint): bigint => (b === BigInt(0) ? a : gcd(b, a % b));
const lcm = (a: bigint, b: bigint) => (a / gcd(a, b)) * b;

export function settlePeople({
  total,
  alcohol,
  beverage,
  sponsor = 0,
  groups,
  personal,
}: SettlementInput & { personal: PersonalItem[] }): PeopleSettlementResult {
  if (![total, alcohol, beverage, sponsor].every(isWon) || !personal.every((item) => isWon(item.amount))) {
    return { ok: false, error: '금액은 0 이상의 정수로 입력해주세요' };
  }
  if (groups.some((g) => g.count > 0 && g.names.length === 0)) {
    return { ok: false, error: '개인 메뉴가 있으면 사람마다 이름을 적어주세요' };
  }
  const people = groups.flatMap((group) => group.names.map((name) => ({ name, group })));
  const seen = new Set<string>();
  const dup = people.find((p) => (seen.has(p.name) ? true : (seen.add(p.name), false)));
  if (dup) return { ok: false, error: `같은 이름이 두 번 있어요: ${dup.name}` };
  if (people.length === 0) return { ok: false, error: '인원을 입력해주세요' };
  if (total === 0) return { ok: false, error: '총 금액을 입력해주세요' };
  if (personal.some((item) => item.eaters.length === 0)) {
    return { ok: false, error: '먹은 사람을 고르지 않은 개인 메뉴가 있어요' };
  }
  const stranger = personal.flatMap((item) => item.eaters).find((name) => !seen.has(name));
  if (stranger) return { ok: false, error: `이름 칸에 없는 사람이 골라져 있어요: ${stranger}` };

  const personalSum = personal.reduce((sum, item) => sum + item.amount, 0);
  if (alcohol + beverage + personalSum > total) {
    return { ok: false, error: '술값·음료값·개인 메뉴의 합이 총액보다 커요' };
  }
  if (sponsor > total) return { ok: false, error: '찬조 금액이 총액보다 커요' };
  const alcoholCount = people.filter((p) => p.group.alcohol).length;
  const beverageCount = people.filter((p) => p.group.beverage).length;
  if (alcohol > 0 && alcoholCount === 0) return { ok: false, error: '술값이 있는데 술 마신 사람이 없어요' };
  if (beverage > 0 && beverageCount === 0) return { ok: false, error: '음료값이 있는데 음료 마신 사람이 없어요' };

  // 나눗셈이 여러 종류(전원·술·음료·품목마다 먹은 사람 수)라 공통 분모(최소공배수)로 정수 계산 — 소수로 더하면 1원씩 어긋난다
  const common = total - alcohol - beverage - personalSum;
  const collectTotal = total - sponsor;
  const n = BigInt(people.length);
  const a = BigInt(alcoholCount || 1);
  const b = BigInt(beverageCount || 1);
  const denominator = [n, a, b, ...personal.map((item) => BigInt(item.eaters.length))].reduce(lcm);
  const shares = people.map(({ name, group }) => {
    let numerator = BigInt(common) * (denominator / n);
    if (group.alcohol) numerator += BigInt(alcohol) * (denominator / a);
    if (group.beverage) numerator += BigInt(beverage) * (denominator / b);
    for (const item of personal) {
      if (item.eaters.includes(name)) numerator += BigInt(item.amount) * (denominator / BigInt(item.eaters.length));
    }
    // 찬조는 모두의 몫을 같은 비율로 줄인다(collectTotal / total)
    const perPerson = Number((numerator * BigInt(collectTotal)) / (denominator * BigInt(total)));
    return { name, group, perPerson };
  });
  const collected = shares.reduce((sum, s) => sum + s.perPerson, 0);
  return {
    ok: true,
    common,
    headcount: people.length,
    collectTotal,
    people: [...shares].sort((x, y) => y.perPerson - x.perPerson),
    remainder: collectTotal - collected,
  };
}

// 사람별 카톡 문구 — 그룹별 문구와 같은 머리말, 금액은 사람마다 한 줄
export function settlementPeopleText({
  total,
  when,
  place,
  people,
}: {
  total: number;
  when: string;
  place: string;
  people: PersonShare[];
}): string {
  return [
    '안녕하세요~',
    `${when} ${place.trim() || '뒤풀이'} 정산 안내드립니다!`,
    '',
    ` 총 금액: ${won(total)}`,
    '',
    '개인별 입금 금액',
    ...people.map((p) => `- ${p.name}: ${won(p.perPerson)}`),
    '',
    '카페나 아래 계좌 중에 편한걸로 부탁드립니다!',
  ].join('\n');
}

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

// "승주, 현석" / "승주 현석" 모두 받는다
export const parseNames = (raw: string) => raw.split(/[,\s]+/).filter(Boolean);

// 카톡에 붙여넣을 문구 — 운영진이 쓰던 공지 형식 그대로. 계좌번호는 결제자가 끝에 직접 붙인다
export function settlementText({
  total,
  when,
  place,
  shares,
}: {
  total: number;
  when: string; // "어제" / "10월 3일" — 머리말 앞에 그대로 붙는다
  place: string;
  shares: SettlementShare[];
}): string {
  return [
    '안녕하세요~',
    `${when} ${place.trim() || '뒤풀이'} 정산 안내드립니다!`,
    '',
    ` 총 금액: ${won(total)}`,
    '',
    '개인별 입금 금액',
    ...shares.flatMap((s) => [
      `${s.group.phrase} (${won(s.perPerson)})`,
      ` -> ${s.group.names.length > 0 ? s.group.names.join(', ') : `${s.group.count}명`}`,
    ]),
    '',
    '카페나 아래 계좌 중에 편한걸로 부탁드립니다!',
  ].join('\n');
}
