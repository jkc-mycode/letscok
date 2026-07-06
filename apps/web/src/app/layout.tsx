import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import './globals.css';

// 계기판 느낌의 산업적 서체 조합 — 본문 Plex Sans KR, 타이머/숫자 Plex Mono
const plexKr = IBM_Plex_Sans_KR({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-plex-kr',
});
const plexMono = IBM_Plex_Mono({
  weight: ['400', '600'],
  subsets: ['latin'],
  variable: '--font-plex-mono',
});

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
    <html lang="ko" className={`${plexKr.variable} ${plexMono.variable}`}>
      <body className="court-bg min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
