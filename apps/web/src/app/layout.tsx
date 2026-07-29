import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import { SwRegister } from '@/components/sw-register';
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
  applicationName: '렛츠콕',
  // 기본은 모임원 앱 — 관제판 경로는 app/admin/layout.tsx가 자기 manifest로 덮어쓴다
  manifest: '/manifest/member',
  // 홈 화면에 설치됐을 때의 동작 — capable이 있어야 주소창 없이 뜬다
  // black-translucent는 상태바를 콘텐츠 위에 겹치므로 아래 safe-area 패딩이 짝을 이룬다
  appleWebApp: {
    capable: true,
    title: '렛츠콕',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0c1310',
  viewportFit: 'cover', // 노치 영역까지 배경을 채우고, 여백은 safe-area로 직접 준다
};

// 모든 페이지의 공통 껍데기 — 운영진(/admin, 태블릿 가로)과 모임원(/m, 모바일 세로)
// 라우트가 이 아래에 생긴다. min-h-dvh: 모바일 브라우저 주소창 유무와 무관한 전체 높이
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${plexKr.variable} ${plexMono.variable}`}>
      <body className="court-bg min-h-dvh font-sans antialiased">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
