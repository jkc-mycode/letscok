'use client';

import { useEffect, useState } from 'react';

// 로딩 표시 — 셔틀콕이 포물선을 그리며 네트를 넘어간다(globals.css .net-hop). 앱 아이콘(코트 타일)과 같은 그림 언어
// 실제로 불러오는 동안에만 보인다(일부러 붙잡아 두는 인트로 없음). 3초가 넘으면 Render 무료 서버가 깨는 중일 수 있어 안내를 덧붙인다
// 색은 테마 이름표를 따라간다 — 라이트·다크 모두

const SLOW_MS = 3000;

// 네트 넘기기 — 160×80 그림을 size(높이)에 맞춰 줄인다. 날아가는 길(offset-path)은 CSS 픽셀 기준이라 그림째로 확대·축소한다
export function NetHop({ size = 56 }: { size?: number }) {
  return (
    <div className="shrink-0" style={{ width: size * 2, height: size }} aria-hidden>
      <div className="relative h-20 w-40 origin-top-left" style={{ transform: `scale(${size / 80})` }}>
        <svg viewBox="0 0 160 80" width="160" height="80" className="absolute inset-0">
          <path d="M6 78 H154" stroke="var(--color-court)" strokeWidth="2" strokeOpacity="0.5" />
          <path d="M80 40 V60" stroke="var(--color-court)" strokeWidth="7" strokeOpacity="0.35" />
          <path d="M80 40 V78" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="net-hop -mt-[13px] -ml-[13px] h-[26px] w-[26px]">
          <svg viewBox="0 0 100 100" width="26" height="26">
            <g transform="rotate(-90 50 50)">
              <path d="M33 60 L22 22 Q50 10 78 22 L67 60 Z" fill="var(--color-ink)" />
              <rect x="32" y="57" width="36" height="8" rx="4" fill="var(--color-court)" />
              <path d="M34 64 a16 16 0 0 0 32 0 Z" fill="var(--color-ink)" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

// 전체 화면 첫 로딩 — 네트 넘기기 + LETSCOK, 오래 걸리면 서버 깨우는 중 안내
export function LogoLoader({ className = '' }: { className?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 text-center ${className}`}>
      <NetHop size={64} />
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

// AI 처리 중 — 작은 네트 넘기기 + 빛이 훑고 지나가는 문구(.text-shimmer), 문구는 단계별로 넘어간다
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
      <NetHop size={28} />
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
