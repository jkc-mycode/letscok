// 모임원 본인 식별 — 체크인 시 저장해두고 /m에서 내 출석을 찾는 데 사용

const MEMBER_KEY = 'letscok:member-id';

export function getMemberId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(MEMBER_KEY);
}

export function saveMemberId(memberId: string): void {
  localStorage.setItem(MEMBER_KEY, memberId);
}

export function clearMemberId(): void {
  localStorage.removeItem(MEMBER_KEY);
}
