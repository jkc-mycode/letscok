import type { MetadataRoute } from 'next';

// PWA를 두 개로 나눈다 — 모임원 앱(/m)과 관제판 앱(/admin)
// scope가 서로 겹치지 않으므로 홈 화면에 아이콘이 두 개 생기고, 각자 자기 영역 안에서만 돈다.
// 모임원 앱에서 관제판으로 넘어가다 앱 밖(브라우저)으로 튕겨 나가면 iOS에선 저장소 컨테이너가
// 갈려 체크인 상태가 사라진다 — 경계를 나눈 게 그 사고를 막는 목적이다.

const COMMON = {
  lang: 'ko',
  display: 'standalone',
  background_color: '#0c1310',
  theme_color: '#0c1310',
} as const;

function appIcons(app: 'member' | 'admin'): MetadataRoute.Manifest['icons'] {
  return [
    { src: `/pwa-icon/${app}/192`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `/pwa-icon/${app}/512`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: `/pwa-icon/${app}/maskable-512`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ];
}

// id를 명시하는 이유: 같은 오리진에 앱이 둘이라 브라우저가 둘을 구분할 기준이 필요하다
const MANIFESTS: Record<string, MetadataRoute.Manifest> = {
  member: {
    ...COMMON,
    id: '/m',
    name: '렛츠콕',
    short_name: '렛츠콕',
    description: '내 대기 순서와 코트 현황 보기',
    start_url: '/m',
    scope: '/m',
    icons: appIcons('member'),
  },
  admin: {
    ...COMMON,
    id: '/admin',
    name: '렛츠콕 관제판',
    short_name: '관제판',
    description: '운영진용 인원·코트 관제판',
    start_url: '/admin',
    scope: '/admin',
    icons: appIcons('admin'),
  },
};

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(MANIFESTS).map((app) => ({ app }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ app: string }> },
) {
  const { app } = await params;
  const manifest = MANIFESTS[app];
  if (!manifest) {
    return new Response('Not Found', { status: 404 });
  }
  return Response.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
