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
  const [busy, setBusy] = useState<'on' | 'off' | null>(null); // 켜는 중·끄는 중 — 버튼 안에 진행을 보여 준다
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
    setBusy(on ? 'on' : 'off');
    setError(null);
    try {
      setState(on ? await enablePush(memberId) : await disablePush());
    } catch {
      setError('알림 설정에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  if (state === null || state === 'unsupported') return null;

  if (state === 'needs-install') {
    return (
      <p className="text-center text-caption text-dim">
        홈 화면에 추가하면 내 게임 알림을 받을 수 있어요
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className="rounded-xl bg-amber/10 p-4 text-body-sm text-amber">
        알림이 꺼져 있어요. <b>{deniedGuide()}</b>에서 허용하면 게임 알림을 받을 수 있어요
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {state === 'off' ? (
        // 허용 뒤 기기 등록(애플·구글 알림 서버)에 몇 초 걸린다 — 흐리게만 하면 멈춘 것처럼 보여 진행을 글로 보여 준다
        <button
          onClick={() => void toggle(true)}
          disabled={busy !== null}
          aria-busy={busy === 'on'}
          className="flex min-h-13 items-center gap-3 rounded-xl bg-panel px-4 py-3 text-left"
        >
          {busy === 'on' ? <Spinner className="text-court" /> : <BellIcon className="text-court" />}
          <span className="flex min-w-0 flex-col">
            <span className="text-body font-bold text-court">{busy === 'on' ? '알림 켜는 중…' : '내 게임 알림 받기'}</span>
            <span className="text-caption whitespace-normal text-dim">
              {busy === 'on' ? '처음 한 번은 몇 초 걸릴 수 있어요' : '화면이 꺼져 있어도 알려 드려요'}
            </span>
          </span>
        </button>
      ) : (
        <div className="flex h-13 items-center justify-between rounded-xl bg-panel px-4 text-body-sm">
          <span className="flex items-center gap-2 font-medium text-court">
            {busy === 'off' ? <Spinner /> : <BellIcon />} {busy === 'off' ? '알림 끄는 중…' : '게임 알림 켜짐'}
          </span>
          <button
            onClick={() => void toggle(false)}
            disabled={busy !== null}
            aria-busy={busy === 'off'}
            className="tap text-body-sm text-dim disabled:opacity-50"
          >
            끄기
          </button>
        </div>
      )}
      {error && <p className="text-center text-caption text-coral">{error}</p>}
    </div>
  );
}

// 진행 중 표시 — 종 아이콘과 같은 크기라 바뀌어도 글자가 밀리지 않는다
function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`shrink-0 animate-spin ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// 종 모양 선 아이콘 — 이모지 대신(디자인 시스템: 아이콘은 선 아이콘)
function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
