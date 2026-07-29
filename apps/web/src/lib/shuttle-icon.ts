// 앱 아이콘용 셔틀콕 글리프 — 배경 없이 도형만 담는다
// (크기·여백은 호출부가 정한다: 일반 아이콘은 꽉 차게, maskable은 Android가 원형으로 깎아도
//  잘리지 않도록 더 작게 그린다)
// 이미지 파일 대신 코드로 그리는 이유: 바이너리 에셋 없이 빌드 시 PNG가 생성되고,
// 색을 테마 토큰과 한 곳에서 맞출 수 있다
export const ICON_BG = '#0c1310'; // --color-bg
const FEATHER = '#eaf3ed'; // --color-ink
const BAND = '#3ecf7a'; // --color-court

const SHUTTLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <path d="M36 62 L20 24 Q50 12 80 24 L64 62 Z" fill="${FEATHER}"/>
  <path d="M43 62 L34 19" stroke="${ICON_BG}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M50 62 L50 15.5" stroke="${ICON_BG}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M57 62 L66 19" stroke="${ICON_BG}" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="34" y="58" width="32" height="9" rx="4.5" fill="${BAND}"/>
  <path d="M36 66 a14 14 0 0 0 28 0 Z" fill="${FEATHER}"/>
</svg>`;

// satori(next/og)는 인라인 SVG 엘리먼트를 그대로 못 받아서 data URI 이미지로 넘긴다
export const SHUTTLE_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(SHUTTLE_SVG).toString('base64')}`;
