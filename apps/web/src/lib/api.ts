// 백엔드 REST 공통 클라이언트 — {success, data} 래퍼를 벗기고 한국어 에러 메시지를 던진다

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PASSCODE_KEY = 'letscok:admin-passcode';

// 저장된 패스코드가 서버에서 거부됐을 때 게이트들이 듣는 이벤트
export const ADMIN_UNAUTHORIZED_EVENT = 'letscok:admin-unauthorized';

// 운영진 패스코드는 태블릿 localStorage에 유지 (개인 소모임 규모의 보안 수준으로 충분)
export function getPasscode(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PASSCODE_KEY);
}

export function savePasscode(passcode: string): void {
  localStorage.setItem(PASSCODE_KEY, passcode);
}

export function clearPasscode(): void {
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
  admin?: boolean; // true면 저장된 패스코드를 헤더에 실어 보낸다
  passcode?: string; // 저장 전 검증용 — 지정하면 저장된 값 대신 이 값을 보낸다
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.passcode !== undefined) headers['x-admin-passcode'] = options.passcode;
  else if (options.admin) headers['x-admin-passcode'] = getPasscode() ?? '';

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json().catch(() => null)) as
    | { data?: T; message?: string | string[] }
    | null;

  // 저장된 패스코드로 보낸 요청이 401 = 저장값이 틀렸다(검증 전 저장되던 시절의 값 등)
  // 저장값을 지우고 게이트에 알려 입력 화면으로 돌려보낸다 — 안 그러면 보드는 보이는데 모든 조작이 막힌 채 갇힌다
  // (로그인 화면의 검증 요청은 passcode를 직접 넘기므로 해당 없음 — 틀리면 그 화면에서 에러만 보여준다)
  if (res.status === 401 && options.admin && options.passcode === undefined) {
    clearPasscode();
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
