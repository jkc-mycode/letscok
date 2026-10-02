// 지금 배포된 빌드 ID — 백그라운드에 남아 있던 옛 화면이 자기 번들의 값과 비교해 새 배포를 알아챈다
// (서비스워커는 화면 이동과 /_next/static만 가로채므로 이 요청은 캐시를 거치지 않는다)
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
