// Edge 런타임용 Sentry — 현재 미들웨어를 안 쓰지만 Next 규격상 함께 둔다
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
