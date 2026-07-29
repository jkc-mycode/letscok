import { ImageResponse } from 'next/og';
import { ICON_THEME, shuttleDataUri } from '@/lib/shuttle-icon';

// 관제판 경로의 탭 파비콘 — 태블릿에서 탭을 여러 개 열어둬도 관제판을 바로 찾게
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function AdminIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ICON_THEME.admin.background,
        }}
      >
        <img src={shuttleDataUri('admin')} width={28} height={28} alt="" />
      </div>
    ),
    size,
  );
}
