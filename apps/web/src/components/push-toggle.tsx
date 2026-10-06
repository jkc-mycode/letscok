'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deniedGuide,
  disablePush,
  enablePush,
  getPushState,
  PushState,
  syncPush,
} from '@/lib/push';

// 게임 알림 토글 — 토글은 "권한"이 아니라 "이 기기의 구독"을 켜고 끈다
// (웹은 브라우저·OS의 알림 권한을 코드로 바꿀 수 없다. 권한이 막히면 설정 경로를 안내할 뿐)
export function PushToggle({ memberId }: { memberId: string }) {
  const [state, setState] = useState<PushState | null>(null); // null = 판정 중
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 앱으로 돌아올 때마다 다시 확인 — 설정에서 권한을 바꿔도 앱에 알려주는 이벤트를 믿을 수 없다
  // (iOS 사파리는 권한 변경 이벤트가 발생하지 않고, Android 설치 앱은 실행 시점에만 동기화된다)
  const refresh = useCallback(async () => {
    await syncPush(memberId);
    setState(await getPushState());
  }, [memberId]);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  // 켜기는 클릭 직후 바로 권한 창을 띄워야 한다 — 그 앞에서 네트워크를 기다리면
  // iOS가 사용자 동작으로 인정하지 않아 창이 조용히 안 뜰 수 있다 (enablePush의 첫 동작이 권한 요청)
  const toggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setState(on ? await enablePush(memberId) : await disablePush());
    } catch {
      setError('알림 설정에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (state === null || state === 'unsupported') return null;

  if (state === 'needs-install') {
    return (
      <p className="text-center text-xs text-dim">
        홈 화면에 추가하면 내 게임 알림을 받을 수 있어요
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
        알림이 꺼져 있어요. <b>{deniedGuide()}</b>에서 허용하면 게임 알림을 받을 수 있어요
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {state === 'off' ? (
        <button
          onClick={() => void toggle(true)}
          disabled={busy}
          className="min-h-12 rounded-xl border border-court/40 px-3 text-sm font-medium whitespace-normal text-court disabled:opacity-50"
        >
          🔔 내 게임 알림 받기 — 화면이 꺼져 있어도 알려드려요
        </button>
      ) : (
        <div className="flex h-12 items-center justify-between rounded-xl border border-line px-4 text-sm">
          <span className="text-court">🔔 게임 알림 켜짐</span>
          <button
            onClick={() => void toggle(false)}
            disabled={busy}
            className="text-xs text-dim disabled:opacity-50"
          >
            끄기
          </button>
        </div>
      )}
      {error && <p className="text-center text-xs text-coral">{error}</p>}
    </div>
  );
}
