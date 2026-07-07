import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {};

// Sentry 래핑: 빌드 시 소스맵을 업로드해 스택 트레이스를 원본 코드로 표시
// org/project/토큰은 Vercel env(SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN)에서 읽음
// — 토큰이 없으면(로컬 빌드) 업로드만 건너뛰고 빌드는 정상 진행된다
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  widenClientFileUpload: true, // 더 넓은 소스맵 업로드로 스택 가독성 향상
  webpack: { treeshake: { removeDebugLogging: true } }, // 번들에서 Sentry 디버그 로거 제거
});
