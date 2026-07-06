// 백엔드 REST 공통 클라이언트 — {success, data} 래퍼를 벗기고 한국어 에러 메시지를 던진다

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PASSCODE_KEY = 'letscok:admin-passcode';

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
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.admin) headers['x-admin-passcode'] = getPasscode() ?? '';

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json().catch(() => null)) as
    | { data?: T; message?: string | string[] }
    | null;

  if (!res.ok) {
    // NestJS 에러 응답의 message는 문자열 또는 (ValidationPipe의) 배열
    const message = Array.isArray(json?.message)
      ? json.message[0]
      : (json?.message ?? '요청에 실패했습니다.');
    throw new ApiError(res.status, message);
  }
  return json?.data as T;
}
