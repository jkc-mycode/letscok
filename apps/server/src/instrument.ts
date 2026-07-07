// Sentry 초기화 — 다른 모듈이 로드되기 전에 실행돼야 자동 계측이 걸린다
// (main.ts에서 dotenv 다음, 나머지 모든 import보다 먼저)
import * as Sentry from '@sentry/nestjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // 에러 수집만 사용 — 트레이싱은 무료 이벤트 한도(월 5천) 절약을 위해 비활성
    tracesSampleRate: 0,
    // 요청 바디를 이벤트에 싣지 않음 — 회원 이름·생년월일이 섞여 나가는 것 방지
    sendDefaultPii: false,
  });
}
