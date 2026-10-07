'use client';

import { useState } from 'react';
import { NetHop } from '@/components/logo-loader';

// 서버에 닿지 못했을 때의 화면 — "아직 모임 전"과 구분한다. 훅이 5초마다 다시 시도하므로 버튼은 기다리기 싫을 때용
export function ConnectionError({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {/* 저절로 다시 시도하는 중이라 멈춘 화면처럼 보이지 않게 */}
      <NetHop size={44} />
      <h1 className="text-xl font-bold">연결이 원활하지 않아요</h1>
      <p className="text-sm leading-relaxed text-dim">
        서버를 깨우는 중이거나 인터넷이 불안정해요.
        <br />
        잠시 뒤 저절로 다시 연결돼요.
      </p>
      <button
        onClick={async () => {
          setRetrying(true);
          await onRetry();
          setRetrying(false);
        }}
        disabled={retrying}
        className="mt-2 h-12 rounded-xl border border-court/50 px-8 text-sm font-bold text-court disabled:opacity-50"
      >
        {retrying ? '연결하는 중…' : '다시 시도'}
      </button>
    </div>
  );
}
