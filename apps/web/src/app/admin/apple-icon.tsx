import { ImageResponse } from 'next/og';
import { ICON_THEME, shuttleDataUri } from '@/lib/shuttle-icon';

// iOS 홈 화면 아이콘(관제판 앱) — 모임원 앱과 나란히 놓이므로 색을 반전해 구분한다
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AdminAppleIcon() {
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
        <img src={shuttleDataUri('admin')} width={130} height={130} alt="" />
      </div>
    ),
    size,
  );
}
