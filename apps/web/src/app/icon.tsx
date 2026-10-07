import { ImageResponse } from 'next/og';
import { ICON_THEME, iconDataUri } from '@/lib/shuttle-icon';

// 브라우저 탭 파비콘 — 32px에선 서비스 라인·셔틀콕이 뭉개지므로 코트 바깥 라인과 네트만(simple)
// (관제판 경로는 app/admin/icon.tsx가 덮어써서 초록 아이콘이 뜬다)
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
          background: ICON_THEME.member.background,
        }}
      >
        <img src={iconDataUri('member', 'simple')} width={28} height={28} alt="" />
      </div>
    ),
    size,
  );
}
