import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // PWA를 모임원 앱(/m)과 관제판 앱(/admin)으로 나누면서 경로를 각 앱 아래로 모았다
  // (PWA scope는 경로 접두사라 한 앱에 속한 화면이 같은 접두사 아래 있어야 한다)
  // 카톡·공지에 이미 뿌려진 구 링크가 죽지 않도록 영구 리다이렉트로 살려둔다
  async redirects() {
    return [
      { source: '/checkin', destination: '/m/checkin', permanent: true },
      { source: '/history', destination: '/admin/history', permanent: true },
      { source: '/history/:path*', destination: '/admin/history/:path*', permanent: true },
    ];
  },
};

// Sentry 래핑: 빌드 시 소스맵을 업로드해 스택 트레이스를 원본 코드로 표시
// org/project/토큰은 Vercel env(SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN)에서 읽음
// — 토큰이 없으면(로컬 빌드) 업로드만 건너뛰고 빌드는 정상 진행된다
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  widenClientFileUpload: true, // 더 넓은 소스맵 업로드로 스택 가독성 향상
  webpack: { treeshake: { removeDebugLogging: true } }, // 번들에서 Sentry 디버그 로거 제거
});
