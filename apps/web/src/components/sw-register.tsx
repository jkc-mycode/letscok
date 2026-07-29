'use client';

import { useEffect } from 'react';

// 서비스워커 등록 — Android 크롬은 fetch 핸들러를 가진 워커가 있어야 "앱 설치"를 제안한다
// 개발 모드에선 등록하지 않는다: 캐시가 끼면 코드를 고쳐도 반영이 안 된 것처럼 보여 디버깅이 꼬인다
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    // 첫 화면 렌더와 경쟁하지 않도록 load 이후에 등록
    const register = () => {
      void navigator.serviceWorker.register('/sw.js');
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
