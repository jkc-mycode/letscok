// 브라우저 쪽 Sentry — 모임원/운영진 기기에서 터지는 에러를 수집
// (서버 로그에는 절대 안 남는 영역이라 Sentry의 핵심 가치가 여기)
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // 에러 수집만 — 트레이싱·리플레이는 무료 한도 절약을 위해 비활성
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

// 페이지 전환 계측 훅 — SDK 규격상 export 필요 (트레이싱 꺼져 있어 실전송은 없음)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
