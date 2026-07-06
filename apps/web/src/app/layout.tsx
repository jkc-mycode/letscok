import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '렛츠콕',
  description: '배드민턴 모임 인원·코트 관리',
};

// 모든 페이지의 공통 껍데기 — 운영진(/admin, 태블릿 가로)과 모임원(/m, 모바일 세로)
// 라우트가 이 아래에 생긴다. min-h-dvh: 모바일 브라우저 주소창 유무와 무관한 전체 높이
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
