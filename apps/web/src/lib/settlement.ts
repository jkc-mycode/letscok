// 뒤풀이 정산 계산 — 금액을 공통(전원)·술(술 마신 사람)·음료(음료 마신 사람) 세 묶음으로 나눠 각자 해당 묶음만 낸다
// 그룹은 배열로 받는다 — 나중에 "2차만 참석" 같은 그룹이 생겨도 표시 조합만 추가하면 된다

export interface SettlementGroup {
  key: string;
  label: string;
  alcohol: boolean; // 술값을 나눠 내는지
  beverage: boolean; // 음료값을 나눠 내는지
  count: number;
}

export interface SettlementInput {
  total: number;
  alcohol: number;
  beverage: number;
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
      shares: SettlementShare[]; // 인원 0명인 그룹은 뺀다
      remainder: number; // 내림으로 남은 몇 원 — 결제자 부담
    }
  | { ok: false; error: string };

export const DEFAULT_GROUPS: SettlementGroup[] = [
  { key: 'both', label: '술+음료', alcohol: true, beverage: true, count: 0 },
  { key: 'alcohol', label: '술만', alcohol: true, beverage: false, count: 0 },
  { key: 'beverage', label: '음료만', alcohol: false, beverage: true, count: 0 },
  { key: 'none', label: '안 마심', alcohol: false, beverage: false, count: 0 },
];

const isWon = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function settle({ total, alcohol, beverage, groups }: SettlementInput): SettlementResult {
  if (![total, alcohol, beverage].every(isWon) || !groups.every((g) => isWon(g.count))) {
    return { ok: false, error: '금액과 인원은 0 이상의 정수로 입력해주세요' };
  }
  const headcount = groups.reduce((sum, g) => sum + g.count, 0);
  const alcoholCount = groups.reduce((sum, g) => sum + (g.alcohol ? g.count : 0), 0);
  const beverageCount = groups.reduce((sum, g) => sum + (g.beverage ? g.count : 0), 0);

  if (total === 0) return { ok: false, error: '총 금액을 입력해주세요' };
  if (headcount === 0) return { ok: false, error: '인원을 입력해주세요' };
  if (alcohol + beverage > total) return { ok: false, error: '술값과 음료값의 합이 총액보다 커요' };
  if (alcohol > 0 && alcoholCount === 0) return { ok: false, error: '술값이 있는데 술 마신 사람이 없어요' };
  if (beverage > 0 && beverageCount === 0) return { ok: false, error: '음료값이 있는데 음료 마신 사람이 없어요' };

  const common = total - alcohol - beverage;
  // 정수 연산으로 한 번에 내림 — 소수로 더하면 27133.333…처럼 나눠떨어지는 경우에도 1원 어긋날 수 있다
  const a = alcoholCount || 1;
  const b = beverageCount || 1;
  const denominator = headcount * a * b;
  const shares = groups
    .filter((g) => g.count > 0)
    .map((group) => {
      const numerator =
        common * a * b + (group.alcohol ? alcohol * headcount * b : 0) + (group.beverage ? beverage * headcount * a : 0);
      return { group, perPerson: Math.floor(numerator / denominator) };
    });
  const collected = shares.reduce((sum, s) => sum + s.perPerson * s.group.count, 0);
  return { ok: true, common, headcount, shares, remainder: total - collected };
}

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

// 카톡에 붙여넣을 문구 — 계좌번호는 결제자가 뒤에 직접 붙인다
export function settlementText(total: number, shares: SettlementShare[]): string {
  return [
    `🍻 뒤풀이 정산 (총 ${won(total)})`,
    ...shares.map((s) => `${s.group.label} ${won(s.perPerson)} (${s.group.count}명)`),
  ].join('\n');
}
