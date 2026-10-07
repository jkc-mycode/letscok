// 앱 아이콘 글리프 — 위에서 본 코트(바깥 라인·서비스 라인·네트) 위에 작은 셔틀콕. 배경 없이 도형만 담는다
// (크기·여백은 호출부가 정한다: 일반 아이콘은 꽉 차게, maskable은 Android가 원형으로 깎아도
//  잘리지 않도록 더 작게 그린다)
// 이미지 파일 대신 코드로 그리는 이유: 바이너리 에셋 없이 빌드 시 PNG가 생성되고,
// 색을 테마 토큰과 한 곳에서 맞출 수 있다
const BG = '#0c1310'; // --color-bg
const INK = '#eaf3ed'; // --color-ink
const COURT = '#3ecf7a'; // --color-court

// 모임원 앱과 관제판 앱은 홈 화면에 나란히 놓이므로 한눈에 구분돼야 한다
// — 같은 코트 타일을 쓰되 배경/라인 색을 서로 반전시킨다(네트는 둘 다 밝은 색)
export const ICON_THEME = {
  member: { background: BG, line: COURT, net: INK, shuttle: INK, band: COURT },
  admin: { background: COURT, line: BG, net: INK, shuttle: BG, band: INK },
} as const;

export type IconApp = keyof typeof ICON_THEME;

// full = 홈 화면·설치 아이콘 / simple = 브라우저 탭(32px) — 작으면 서비스 라인·셔틀콕이 뭉개져 바깥 라인과 네트만
export type IconDetail = 'full' | 'simple';

function courtSvg(theme: (typeof ICON_THEME)[IconApp], detail: IconDetail): string {
  if (detail === 'simple') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect x="24" y="14" width="52" height="72" rx="3" stroke="${theme.line}" stroke-width="8"/>
  <path d="M17 50 H83" stroke="${theme.net}" stroke-width="9" stroke-linecap="round"/>
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect x="24" y="14" width="52" height="72" rx="3" stroke="${theme.line}" stroke-width="3"/>
  <path d="M24 36 H76 M24 64 H76 M50 14 V36 M50 64 V86" stroke="${theme.line}" stroke-width="2" stroke-opacity="0.6"/>
  <path d="M17 50 H83" stroke="${theme.net}" stroke-width="4" stroke-linecap="round"/>
  <g transform="translate(63 26) rotate(28) scale(0.32) translate(-50 -54)">
    <path d="M33 60 L22 22 Q50 10 78 22 L67 60 Z" fill="${theme.shuttle}"/>
    <rect x="32" y="57" width="36" height="8" rx="4" fill="${theme.band}"/>
    <path d="M34 64 a16 16 0 0 0 32 0 Z" fill="${theme.shuttle}"/>
  </g>
</svg>`;
}

// satori(next/og)는 인라인 SVG 엘리먼트를 그대로 못 받아서 data URI 이미지로 넘긴다
export function iconDataUri(app: IconApp, detail: IconDetail = 'full'): string {
  return `data:image/svg+xml;base64,${Buffer.from(courtSvg(ICON_THEME[app], detail)).toString('base64')}`;
}
