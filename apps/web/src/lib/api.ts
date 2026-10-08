// 백엔드 REST 공통 클라이언트 — {success, data} 래퍼를 벗기고 한국어 에러 메시지를 던진다

import type { IAdminTokenResponse } from '@letscok/shared-types';

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PASSCODE_KEY = 'letscok:admin-passcode'; // 예전 방식(패스코드 원문 저장) — 토큰으로 바꾸면 지운다
const TOKEN_KEY = 'letscok:admin-token'; // 운영진 출입증(30일) — 패스코드 대신 이것만 저장

// 저장된 패스코드가 서버에서 거부됐을 때 게이트들이 듣는 이벤트
export const ADMIN_UNAUTHORIZED_EVENT = 'letscok:admin-unauthorized';

// 운영진 로그인 정보 — 출입증(토큰)이 기본. 서버에 토큰 비밀값이 없으면 예전처럼 패스코드를 저장한다
export function getPasscode(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PASSCODE_KEY);
}

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function hasAdminLogin(): boolean {
  return Boolean(getAdminToken() || getPasscode());
}

// 토큰을 받았으면 토큰만 남기고 패스코드 원문은 지운다
export function saveAdminLogin(token: string | null, passcode: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(PASSCODE_KEY);
  } else {
    localStorage.setItem(PASSCODE_KEY, passcode);
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearAdminLogin(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PASSCODE_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  admin?: boolean; // true면 저장된 출입증(없으면 패스코드)을 헤더에 실어 보낸다
  passcode?: string; // 저장 전 검증용 — 지정하면 저장된 값 대신 이 값을 보낸다
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  // FormData(파일 업로드)는 그대로 보낸다 — Content-Type은 브라우저가 boundary까지 붙여 정한다
  const isForm = options.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (options.passcode !== undefined) headers['x-admin-passcode'] = options.passcode;
  else if (options.admin) {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    else headers['x-admin-passcode'] = getPasscode() ?? '';
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.body === undefined
        ? undefined
        : isForm
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });

  const json = (await res.json().catch(() => null)) as
    | { data?: T; message?: string | string[] }
    | null;

  // 저장된 로그인 정보로 보낸 요청이 401 = 출입증 만료·패스코드 변경 등
  // 저장값을 지우고 게이트에 알려 입력 화면으로 돌려보낸다 — 안 그러면 보드는 보이는데 모든 조작이 막힌 채 갇힌다
  // (로그인 화면의 검증 요청은 passcode를 직접 넘기므로 해당 없음 — 틀리면 그 화면에서 에러만 보여준다)
  if (res.status === 401 && options.admin && options.passcode === undefined) {
    clearAdminLogin();
    window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
  }

  if (!res.ok) {
    // NestJS 에러 응답의 message는 문자열 또는 (ValidationPipe의) 배열
    const message = Array.isArray(json?.message)
      ? json.message[0]
      : (json?.message ?? '요청에 실패했습니다.');
    throw new ApiError(res.status, message);
  }
  return json?.data as T;
}

// 패스코드로 출입증을 받는다. 서버가 아직 토큰을 모르면(새 웹이 먼저 배포된 사이 404) 예전 확인으로 대신한다
export async function loginWithPasscode(passcode: string): Promise<string | null> {
  try {
    const res = await api<IAdminTokenResponse>('/auth/admin/token', { method: 'POST', passcode });
    return res.token;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
    await api('/auth/admin/verify', { method: 'POST', passcode });
    return null;
  }
}

// 예전에 패스코드 원문을 저장해 둔 기기 — 한 번 출입증으로 바꾸고 원문을 지운다
// 패스코드가 틀렸으면 'rejected'(입력 화면으로), 서버에 닿지 않거나 토큰 기능이 꺼져 있으면 그대로 둔다
export async function upgradeStoredPasscode(): Promise<'upgraded' | 'rejected' | 'kept'> {
  const passcode = getPasscode();
  if (!passcode || getAdminToken()) return 'kept';
  try {
    const token = await loginWithPasscode(passcode);
    if (!token) return 'kept';
    saveAdminLogin(token, passcode);
    return 'upgraded';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      clearAdminLogin();
      return 'rejected';
    }
    return 'kept';
  }
}
