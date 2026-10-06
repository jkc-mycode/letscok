'use client';

import { ThemePref, useTheme } from '@/lib/theme';

// 화면 테마 고르기 — 시스템(폰 설정 따라가기)·라이트·다크. 기기마다 따로 저장된다
const OPTIONS: { value: ThemePref; label: string; icon: string }[] = [
  { value: 'system', label: '시스템', icon: '◐' },
  { value: 'light', label: '라이트', icon: '☀' },
  { value: 'dark', label: '다크', icon: '☾' },
];

// 3칸 세그먼트 — 더보기 시트·모임원 앱·모임 전 화면용
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [pref, setPref] = useTheme();
  return (
    <div role="radiogroup" aria-label="화면 테마" className={`flex rounded-xl border border-line bg-panel2 p-1 ${className}`}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={pref === option.value}
          onClick={() => setPref(option.value)}
          className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm ${
            pref === option.value ? 'bg-panel font-bold text-ink shadow-sm' : 'text-dim'
          }`}
        >
          <span aria-hidden>{option.icon}</span>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// 아이콘 한 개 — 누를 때마다 시스템 → 라이트 → 다크 순서로(태블릿 관제판 헤더용, 자리가 좁아서)
export function ThemeCycleButton({ className = '' }: { className?: string }) {
  const [pref, setPref] = useTheme();
  const index = OPTIONS.findIndex((o) => o.value === pref);
  const current = OPTIONS[index];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  return (
    <button
      onClick={() => setPref(next.value)}
      aria-label={`화면 테마: ${current.label} (누르면 ${next.label})`}
      title={`화면 테마: ${current.label} — 누르면 ${next.label}`}
      className={className}
    >
      {current.icon}
    </button>
  );
}
