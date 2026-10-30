import { createHmac, timingSafeEqual } from 'node:crypto';

// 모임원 본인 확인 값 — 입장 코드를 맞힌 기기에만 준다. 출석 id만 알면 남을 휴식시키고 알림을 가로채던 틈을 막는다
// 회원 id에 서명한 값이라 DB에 저장하지 않고, 폰 여러 대·다음 모임에서도 그대로 쓴다
// 운영진 토큰과 같은 비밀값을 쓰되 용도 문자열을 섞어 서로 바꿔 쓸 수 없게 한다. 비밀값을 바꾸면 전부 무효
function signingKey(): Buffer | null {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update('member-token').digest();
}

export function signMemberToken(memberId: string): string | null {
  const key = signingKey();
  if (!key) return null;
  return createHmac('sha256', key).update(memberId).digest('base64url');
}

// 비밀값이 없으면 늘 거짓 — 본인 확인 없이 열어 두지 않는다(운영진은 운영진 인증으로 통과)
export function verifyMemberToken(memberId: string, token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const expected = signMemberToken(memberId);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
