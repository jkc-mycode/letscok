// 테마 첫 적용 — 서버 컴포넌트(layout.tsx)가 문자열로 써야 해서 'use client' 파일(theme.ts)과 분리한다
// (클라이언트 파일에서 가져오면 문자열이 아니라 클라이언트 참조가 넘어온다)

export type ResolvedTheme = 'light' | 'dark';
export const THEME_KEY = 'letscok:theme';
export const THEME_DEFAULT = 'dark' as const; // 고른 적 없으면 다크(예전부터의 기본)
// 상태바·주소창 색 — 배경색(--color-bg)과 맞춘다
export const BAR_COLOR: Record<ResolvedTheme, string> = { dark: '#0c1310', light: '#f3f6f4' };

export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement,t='dark';try{var p=localStorage.getItem('${THEME_KEY}')||'${THEME_DEFAULT}';t=p==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):(p==='light'?'light':'dark')}catch(e){}d.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='light'?'${BAR_COLOR.light}':'${BAR_COLOR.dark}')})();`;
