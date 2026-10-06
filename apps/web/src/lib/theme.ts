'use client';

import { useCallback, useEffect, useState } from 'react';
import { BAR_COLOR, ResolvedTheme, THEME_DEFAULT as DEFAULT, THEME_KEY as KEY } from './theme-init';

// 화면 테마 — 시스템(폰 설정 따라가기)·라이트·다크. 기기마다 따로 저장하고, 고른 적 없으면 다크(예전부터의 기본)
// 실제 적용은 <html data-theme="light|dark">와 globals.css의 색 이름표 재정의가 한다.
// 첫 화면이 깜빡이지 않도록 같은 판단을 layout.tsx가 먼저 실행하는 스크립트(theme-init.ts)도 한다

export type ThemePref = 'system' | 'light' | 'dark';

const CHANGE_EVENT = 'letscok:theme-change';

function readPref(): ThemePref {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'system' || value === 'light' || value === 'dark' ? value : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(pref: ThemePref) {
  const theme = resolve(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[theme]);
}

// 테마 선택 UI용 — 고르면 저장·즉시 적용, '시스템'이면 폰 설정이 바뀔 때도 따라간다
export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPrefState] = useState<ThemePref>(DEFAULT);

  // 같은 화면에 버튼이 둘(태블릿 헤더 아이콘 + 더보기 시트)일 수 있어 한쪽에서 바꾸면 다른 쪽 표시도 맞춘다
  useEffect(() => {
    setPrefState(readPref());
    const onChange = (e: Event) => setPrefState((e as CustomEvent<ThemePref>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 저장이 막힌 브라우저(사생활 보호 모드 등) — 이번 실행 동안만 적용
    }
    apply(next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }, []);

  return [pref, setPref];
}
