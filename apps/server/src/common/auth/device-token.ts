import { createHmac, timingSafeEqual } from 'node:crypto';

// 신뢰 기기 표시 — 패스코드를 맞힌 적 있는 기기에 준다. 전체 잠금 공격 중에도 평소 쓰던 기기는 패스코드를 입력할 수 있게 한다
// 로그인 자체를 대신하지 않는다: 공용 기기라 로그아웃해도 남고, 패스코드는 매번 입력해야 한다
// 패스코드를 서명 키에 넣지 않는다 — 공격을 받아 패스코드를 바꾼 직후에도 이 기기로 들어와야 하기 때문
export const DEVICE_TOKEN_TTL_SEC = 180 * 24 * 60 * 60; // 로그인할 때마다 새로 받는다

function signingKey(): Buffer | null {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update('device-token').digest();
}

function sign(exp: string, key: Buffer): string {
  return createHmac('sha256', key).update(exp).digest('base64url');
}

export function issueDeviceToken(now = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = String(Math.floor(now / 1000) + DEVICE_TOKEN_TTL_SEC);
  return `${exp}.${sign(exp, key)}`;
}

export function verifyDeviceToken(token: unknown, now = Date.now()): boolean {
  const key = signingKey();
  if (!key || typeof token !== 'string') return false;
  const [exp, signature, extra] = token.split('.');
  if (!exp || !signature || extra !== undefined || !/^\d+$/.test(exp)) return false;
  const expected = Buffer.from(sign(exp, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(exp) * 1000 > now;
}
