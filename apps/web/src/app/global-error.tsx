'use client';

// React 렌더링 자체가 죽었을 때(화면 하얘짐)의 최후 안전망 —
// 에러를 Sentry로 보고하고 새로고침 안내를 띄운다
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    // global-error는 루트 레이아웃을 대체하므로 html/body를 직접 렌더링해야 한다
    <html lang="ko">
      <body style={{ background: '#0c1310', color: '#eaf3ed', fontFamily: 'sans-serif' }}>
        <main
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            textAlign: 'center',
            padding: 24,
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>화면에 문제가 생겼어요</h1>
          <p style={{ color: '#8ba496' }}>오류가 자동으로 접수됐어요. 다시 시도해주세요.</p>
          <button
            onClick={reset}
            style={{
              height: 48,
              padding: '0 32px',
              borderRadius: 12,
              border: 'none',
              background: '#3ecf7a',
              color: '#0c1310',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
