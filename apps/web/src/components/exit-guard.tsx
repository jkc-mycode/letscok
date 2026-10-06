'use client';

import { useExitGuard } from '@/lib/back-stack';

// 첫 화면에서 뒤로가기를 한 번 눌렀을 때의 안내 — 2초 안에 한 번 더 누르면 앱이 닫힌다 (설치된 앱에서만 동작)
export function ExitGuard() {
  const warning = useExitGuard();
  if (!warning) return null;
  return (
    <p className="fade-in fixed bottom-[calc(var(--safe-bottom)+1.5rem)] left-1/2 z-50 -translate-x-1/2 rounded-xl border border-line bg-panel px-5 py-3 text-sm whitespace-nowrap shadow-lg">
      뒤로 한 번 더 누르면 종료돼요
    </p>
  );
}
