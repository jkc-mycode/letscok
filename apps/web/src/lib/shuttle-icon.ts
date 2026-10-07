// 앱 아이콘 글리프 — 살짝 기울인 셔틀콕(깃털 + 실 띠 + 깃대 3줄 + 코르크 띠). 배경 없이 도형만 담는다
// (크기·여백은 호출부가 정한다: 일반 아이콘은 꽉 차게, maskable은 Android가 원형으로 깎아도
//  잘리지 않도록 더 작게 그린다)
// 이미지 파일 대신 코드로 그리는 이유: 바이너리 에셋 없이 빌드 시 PNG가 생성되고,
// 색을 테마 토큰과 한 곳에서 맞출 수 있다
const BG = '#0c1310'; // --color-bg
const INK = '#eaf3ed'; // --color-ink
const COURT = '#3ecf7a'; // --color-court

// 모임원 앱(렛츠콕)과 운영진 앱(렛츠콕 운영)은 홈 화면에 나란히 놓이므로 한눈에 구분돼야 한다
// — 같은 셔틀콕을 쓰되 배경/글리프 색을 서로 반전시킨다
export const ICON_THEME = {
  member: { background: BG, feather: INK, band: COURT, stroke: BG },
  admin: { background: COURT, feather: BG, band: INK, stroke: COURT },
} as const;

export type IconApp = keyof typeof ICON_THEME;

// full = 홈 화면·설치 아이콘 / simple = 브라우저 탭(32px) — 작으면 가는 줄이 뭉개져 깃털·띠·코르크 덩어리만
export type IconDetail = 'full' | 'simple';

function shuttleSvg(theme: (typeof ICON_THEME)[IconApp], detail: IconDetail): string {
  const lines =
    detail === 'full'
      ? `<path d="M27 37 Q50 31 73 37" stroke="${theme.stroke}" stroke-width="2"/>
    <path d="M40 60 L32 19" stroke="${theme.stroke}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M50 60 L50 14" stroke="${theme.stroke}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M60 60 L68 19" stroke="${theme.stroke}" stroke-width="2.2" stroke-linecap="round"/>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <g transform="rotate(-14 50 54)">
    <path d="M33 60 L22 22 Q50 10 78 22 L67 60 Z" fill="${theme.feather}"/>
    ${lines}
    <rect x="32" y="57" width="36" height="8" rx="4" fill="${theme.band}"/>
    <path d="M34 64 a16 16 0 0 0 32 0 Z" fill="${theme.feather}"/>
  </g>
</svg>`;
}

// satori(next/og)는 인라인 SVG 엘리먼트를 그대로 못 받아서 data URI 이미지로 넘긴다
export function iconDataUri(app: IconApp, detail: IconDetail = 'full'): string {
  return `data:image/svg+xml;base64,${Buffer.from(shuttleSvg(ICON_THEME[app], detail)).toString('base64')}`;
}
