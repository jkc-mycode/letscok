import { ImageResponse } from 'next/og';
import { ICON_BG, SHUTTLE_DATA_URI } from '@/lib/shuttle-icon';

// 브라우저 탭 파비콘 — 32px에선 결이 뭉개지므로 셔틀콕만 크게 채운다
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
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
        <img src={SHUTTLE_DATA_URI} width={28} height={28} alt="" />
      </div>
    ),
    size,
  );
}
