'use client';

import { useEffect, useRef, useState } from 'react';

// 새 버전 안내 — PWA는 백그라운드에 오래 남아 있다가 다시 열면 옛 화면을 그대로 이어 보여준다.
// 배포를 알아채면 배너만 띄우고, 새로고침은 사용자가 누를 때만 한다(관제판 입력 중 유실 방지)
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 모임 내내 켜 둔 관제판 태블릿용
const MIN_GAP_MS = 30 * 1000; // 앱 전환을 반복할 때 요청이 몰리지 않게

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastCheckedAt = useRef(Date.now()); // 막 불러온 화면은 최신이므로 마운트 시점을 확인 시각으로 친다

  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckedAt.current < MIN_GAP_MS) return;
      lastCheckedAt.current = Date.now();
      try {
        const res = await fetch('/version', { cache: 'no-store' });
        const { buildId } = (await res.json()) as { buildId?: string };
        if (buildId && buildId !== BUILD_ID) setStale(true);
      } catch {
        // 오프라인 등 — 다음 확인 때 다시 본다
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setHidden(false); // [나중에]는 이번 실행 동안만 — 앱으로 돌아오면 다시 띄운다
      void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  if (!stale || hidden) return null;
  return (
    // 모달(z-40·z-50) 아래 — 모달 조작을 가리지 않고, 닫으면 보인다
    <div
      className="fixed inset-x-0 top-0 z-30 flex justify-center px-3"
      style={{ paddingTop: 'calc(var(--safe-top) + 0.5rem)' }}
    >
      <div className="fade-in flex w-full max-w-md items-center gap-3 rounded-xl border border-court/40 bg-panel px-4 py-3 shadow-lg">
        <p className="flex-1 text-sm font-medium">새 버전이 나왔어요</p>
        <button onClick={() => setHidden(true)} className="tap text-xs text-dim">
          나중에
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-court px-3 py-1.5 text-sm font-bold text-bg"
        >
          업데이트
        </button>
      </div>
    </div>
  );
}
