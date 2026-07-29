import { ImageResponse } from 'next/og';
import { ICON_THEME, shuttleDataUri, type IconApp } from '@/lib/shuttle-icon';

// 두 manifest가 참조하는 아이콘 — 빌드 시 PNG로 미리 생성된다(force-static)
// maskable은 Android가 기기 테마에 맞춰 원형·스퀘어클로 깎아내므로,
// 안전 영역(가운데 80%) 안에 들어오도록 글리프를 더 작게 그린다
const VARIANTS: Record<string, { size: number; ratio: number }> = {
  '192': { size: 192, ratio: 0.74 },
  '512': { size: 512, ratio: 0.74 },
  'maskable-512': { size: 512, ratio: 0.52 },
};

const APPS: IconApp[] = ['member', 'admin'];

export const dynamic = 'force-static';

export function generateStaticParams() {
  return APPS.flatMap((app) => Object.keys(VARIANTS).map((variant) => ({ app, variant })));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ app: string; variant: string }> },
) {
  const { app, variant } = await params;
  const spec = VARIANTS[variant];
  if (!spec || !APPS.includes(app as IconApp)) {
    return new Response('Not Found', { status: 404 });
  }
  const theme = ICON_THEME[app as IconApp];
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
          background: theme.background,
        }}
      >
        <img src={shuttleDataUri(app as IconApp)} width={glyph} height={glyph} alt="" />
      </div>
    ),
    { width: spec.size, height: spec.size },
  );
}
