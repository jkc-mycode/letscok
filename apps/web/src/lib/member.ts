// 모임원 본인 식별 — 체크인 시 저장해두고 /m에서 내 출석을 찾는 데 사용

import type { IIssueMemberTokenDto, IMemberTokenResponse } from '@letscok/shared-types';
import { api } from './api';

const MEMBER_KEY = 'letscok:member-id';
// 본인 확인 값 — 입장 코드를 맞힌 폰만 받는다. 휴식/복귀·알림 등록에 쓴다
const TOKEN_KEY = 'letscok:member-token';

export function getMemberId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(MEMBER_KEY);
}

// 다른 사람으로 바꾸면 앞사람의 확인 값은 버린다 — 값이 회원마다 달라 남겨 둬도 쓸 수 없다
export function saveMemberId(memberId: string): void {
  if (localStorage.getItem(MEMBER_KEY) !== memberId) localStorage.removeItem(TOKEN_KEY);
  localStorage.setItem(MEMBER_KEY, memberId);
}

export function clearMemberId(): void {
  localStorage.removeItem(MEMBER_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function getMemberToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

// 서버가 확인 값을 거부했을 때(비밀값 교체 등) — 지우고 코드를 다시 받는다
export function clearMemberToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// 입장 코드로 확인 값을 받아 저장 — 코드가 틀리면 서버 메시지 그대로 던진다
export async function fetchMemberToken(sessionId: string, memberId: string, code: string | null): Promise<void> {
  const body: IIssueMemberTokenDto = { memberId, ...(code && { code }) };
  const { token } = await api<IMemberTokenResponse>(`/sessions/${sessionId}/member-token`, { method: 'POST', body });
  localStorage.setItem(TOKEN_KEY, token);
}
