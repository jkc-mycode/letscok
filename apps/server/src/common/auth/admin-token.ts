import { createHmac, timingSafeEqual } from 'node:crypto';

// 운영진 출입증 — 로그인 때만 패스코드를 받고, 이후엔 기기가 이 토큰만 들고 다닌다(패스코드 원문을 저장하지 않게)
// 형식은 JWT(HS256) 표준 그대로, 서명은 Node 기본 암호 기능으로 — 패키지 하나 늘리지 않으려고
// 서명 키 = HMAC(ADMIN_TOKEN_SECRET, ADMIN_PASSCODE): 패스코드를 바꾸면 기존 토큰이 모두 무효가 되고,
// 토큰이 새도 비밀값 없이는 패스코드를 오프라인으로 맞혀 볼 수 없다
export const ADMIN_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30일 — 지나면 패스코드를 다시 입력

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

// 비밀값이 없으면 토큰 기능을 끈다(그 동안은 패스코드 헤더 방식만) — 배포 순서와 상관없이 동작하게
function signingKey(): Buffer | null {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  const passcode = process.env.ADMIN_PASSCODE;
  if (!secret || !passcode) return null;
  return createHmac('sha256', secret).update(passcode).digest();
}

function sign(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

export function issueAdminToken(now = Date.now()): { token: string; expiresAt: string } | null {
  const key = signingKey();
  if (!key) return null;
  const iat = Math.floor(now / 1000);
  const exp = iat + ADMIN_TOKEN_TTL_SEC;
  const payload = base64url(JSON.stringify({ sub: 'admin', iat, exp }));
  return { token: `${HEADER}.${payload}.${sign(`${HEADER}.${payload}`, key)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyAdminToken(token: string, now = Date.now()): boolean {
  const key = signingKey();
  if (!key) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  if (header !== HEADER) return false; // alg 바꿔치기(none 등) 차단 — 우리가 만든 머리만 받는다
  const expected = Buffer.from(sign(`${header}.${payload}`, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown; exp?: unknown };
    return sub === 'admin' && typeof exp === 'number' && exp * 1000 > now;
  } catch {
    return false;
  }
}
