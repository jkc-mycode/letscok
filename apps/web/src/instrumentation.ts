// Next.js 서버 기동 시 런타임별 Sentry 설정을 로드하는 진입점
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// 서버 컴포넌트·미들웨어에서 발생한 에러 수집
export const onRequestError = Sentry.captureRequestError;
