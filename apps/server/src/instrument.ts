// Sentry 초기화 — 다른 모듈이 로드되기 전에 실행돼야 자동 계측이 걸린다
// (main.ts에서 dotenv 다음, 나머지 모든 import보다 먼저)
import * as Sentry from '@sentry/nestjs';

// 에러 원인 파악에 쓰는 헤더만 남긴다 — Sentry 기본값은 패스코드·토큰·쿠키 헤더까지 그대로 보낸다
const KEPT_HEADERS = new Set(['user-agent', 'content-type']);

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // 에러 수집만 사용 — 트레이싱은 무료 이벤트 한도(월 5천) 절약을 위해 비활성
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // sendDefaultPii와 별개로 요청 바디를 10KB까지 읽어 싣는 게 기본값 — 회원 이름·생년월일이 섞여 나가지 않게 끈다
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
    // 보내기 직전 마지막 관문 — 바디·쿠키·검색어(회원 이름)를 지우고 헤더는 허용 목록만
    beforeSend(event) {
      const request = event.request;
      if (!request) return event;
      delete request.data;
      delete request.cookies;
      delete request.query_string;
      if (request.url) request.url = request.url.split('?')[0];
      if (request.headers) {
        request.headers = Object.fromEntries(
          Object.entries(request.headers).filter(([name]) => KEPT_HEADERS.has(name.toLowerCase())),
        );
      }
      return event;
    },
  });
}
