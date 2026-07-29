import { ImageResponse } from 'next/og';
import { ICON_BG, SHUTTLE_DATA_URI } from '@/lib/shuttle-icon';

// manifest가 참조하는 아이콘 — 빌드 시 PNG로 미리 생성된다(force-static)
// maskable은 Android가 기기 테마에 맞춰 원형·스퀘어클로 깎아내므로,
// 안전 영역(가운데 80%) 안에 들어오도록 글리프를 더 작게 그린다
const VARIANTS: Record<string, { size: number; ratio: number }> = {
  '192': { size: 192, ratio: 0.74 },
  '512': { size: 512, ratio: 0.74 },
  'maskable-512': { size: 512, ratio: 0.52 },
};

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variant: string }> },
) {
  const { variant } = await params;
  const spec = VARIANTS[variant];
  if (!spec) {
    return new Response('Not Found', { status: 404 });
  }
  const glyph = Math.round(spec.size * spec.ratio);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ICON_BG,
        }}
      >
        <img src={SHUTTLE_DATA_URI} width={glyph} height={glyph} alt="" />
      </div>
    ),
    { width: spec.size, height: spec.size },
  );
}
