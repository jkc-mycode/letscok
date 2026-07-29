import type { Metadata } from 'next';

// 관제판은 모임원 앱과 별개의 PWA다 — 이 레이아웃이 /admin 이하 전체의 manifest를
// 관제판용으로 덮어써서, 여기서 설치하면 관제판 아이콘·scope로 잡힌다
export const metadata: Metadata = {
  title: '렛츠콕 관제판',
  applicationName: '렛츠콕 관제판',
  manifest: '/manifest/admin',
  appleWebApp: {
    capable: true,
    title: '관제판',
    statusBarStyle: 'black-translucent',
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
