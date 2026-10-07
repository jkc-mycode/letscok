'use client';

import { useEffect, useState } from 'react';

// 로딩 로고 — 앱 아이콘과 같은 셔틀콕이 통통 튀고 바닥 그림자가 따라 커졌다 작아진다(globals.css .logo-bounce)
// 실제로 불러오는 동안에만 보인다(일부러 붙잡아 두는 인트로 없음). 3초가 넘으면 Render 무료 서버가 깨는 중일 수 있어 안내를 덧붙인다
// 색은 테마 이름표를 따라간다 — 라이트·다크 모두

const SLOW_MS = 3000;

// 셔틀콕만 — 연결 오류·서버 깨우기 안내 옆처럼 작은 자리에도 쓴다
export function BouncingShuttle({ size = 56 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center" style={{ width: size }} aria-hidden>
      <svg viewBox="0 0 100 100" width={size} height={size} className="logo-bounce">
        <path d="M36 62 L20 24 Q50 12 80 24 L64 62 Z" fill="var(--color-ink)" />
        <path d="M43 62 L34 19" stroke="var(--color-bg)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M50 62 L50 15.5" stroke="var(--color-bg)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M57 62 L66 19" stroke="var(--color-bg)" strokeWidth="2.4" strokeLinecap="round" />
        <rect x="34" y="58" width="32" height="9" rx="4.5" fill="var(--color-court)" />
        <path d="M36 66 a14 14 0 0 0 28 0 Z" fill="var(--color-ink)" />
      </svg>
      <span className="logo-shadow mt-1 h-1.5 rounded-full bg-ink/30" style={{ width: size * 0.5 }} />
    </div>
  );
}

// 전체 화면 첫 로딩 — 로고 + LETSCOK, 오래 걸리면 서버 깨우는 중 안내
export function LogoLoader({ className = '' }: { className?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 text-center ${className}`}>
      <BouncingShuttle size={72} />
      <p className="text-xs font-medium tracking-[0.3em] text-court">LETSCOK</p>
      <p className="min-h-10 text-sm leading-relaxed text-dim">
        {slow ? (
          <>
            서버를 깨우는 중이에요.
            <br />
            최대 5분 정도 걸릴 수 있어요.
          </>
        ) : (
          <span className="sr-only">불러오는 중</span>
        )}
      </p>
    </div>
  );
}

// AI 처리 중 — 작은 셔틀콕 + 빛이 훑고 지나가는 문구(.text-shimmer), 문구는 단계별로 넘어간다
// 실제 진행률을 아는 게 아니라 시간에 맞춘 대략적인 단계라, 마지막 문구에서 멈춰 기다린다
const STEP_MS = 1600;

export function AiThinking({ steps, note, className = '' }: { steps: string[]; note?: string; className?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= steps.length - 1) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [index, steps.length]);
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 ${className}`}>
      <BouncingShuttle size={28} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* key로 단계마다 다시 그려 살짝 떠오르며 바뀐다 — 떠오르기와 빛 효과는 둘 다 animation이라 요소를 나눈다 */}
        <p key={index} className="fade-in text-sm font-bold">
          <span className="text-shimmer">{steps[Math.min(index, steps.length - 1)]}</span>
        </p>
        {note && <p className="text-xs text-faint">{note}</p>}
      </div>
    </div>
  );
}
