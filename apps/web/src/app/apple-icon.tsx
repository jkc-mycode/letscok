import { ImageResponse } from 'next/og';
import { ICON_BG, SHUTTLE_DATA_URI } from '@/lib/shuttle-icon';

// iOS 홈 화면 아이콘 — 애플은 SVG를 안 받아서 PNG가 반드시 필요하다
// (iOS가 알아서 모서리를 둥글게 깎으므로 여기선 사각 그대로 그린다)
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
        <img src={SHUTTLE_DATA_URI} width={130} height={130} alt="" />
      </div>
    ),
    size,
  );
}
