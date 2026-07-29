import type { MetadataRoute } from 'next';

// PWA 설치 정보 — 이 파일이 있어야 홈 화면 추가가 "북마크"가 아니라 "앱 설치"가 된다
// display: standalone 이 주소창·탭바를 없애는 핵심 스위치
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '렛츠콕',
    short_name: '렛츠콕',
    description: '배드민턴 모임 인원·코트 관리',
    lang: 'ko',
    // 설치하는 사람은 모임원 — 아이콘을 누르면 내 상태부터 본다
    // (미체크인이면 /m 이 [체크인하러 가기] 버튼을 띄우므로 분기가 자연스럽다)
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    background_color: '#0c1310',
    theme_color: '#0c1310',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/pwa-icon/maskable-512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
