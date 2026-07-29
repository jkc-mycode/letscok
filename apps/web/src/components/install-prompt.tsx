'use client';

import { useCallback, useEffect, useState } from 'react';

// 설치 유도 배너 — 접근성이 이번 작업의 목적이라 사실상 여기가 본론이다
// 세 상황을 하나로 처리한다:
//   kakao   카톡 인앱 브라우저 — 여기선 설치가 아예 불가능해서 외부 브라우저로 내보내는 게 먼저
//   android beforeinstallprompt를 잡아뒀다가 버튼 한 번으로 설치
//   ios     프로그램적 설치 불가 — "공유 → 홈 화면에 추가" 안내가 유일한 수단
const DISMISS_KEY = 'letscok:install-dismissed-at';
const DISMISS_DAYS = 7; // 모임이 주 1회라 다음 모임엔 다시 눈에 띈다

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'hidden' | 'kakao' | 'android' | 'ios';

function isDismissed(): boolean {
  const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  if (!at) return false;
  return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

// 이미 홈 화면 앱으로 실행 중이면 설치를 권할 이유가 없다
// (iOS 사파리는 display-mode를 제대로 안 알려줘 navigator.standalone도 같이 본다)
function isInstalled(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function InstallPrompt() {
  const [mode, setMode] = useState<Mode>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isInstalled() || isDismissed()) return;

    const ua = navigator.userAgent;
    if (/KAKAOTALK/i.test(ua)) {
      setMode('kakao');
      return;
    }
    // iPadOS 13+는 UA를 Macintosh로 위장해서 터치 지원 여부로 한 번 더 거른다
    const isIos =
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (isIos) {
      setMode('ios');
      return;
    }

    // Android·데스크톱 크롬 — 브라우저가 설치 가능하다고 판단하면 이 이벤트를 준다
    const onPrompt = (event: Event) => {
      event.preventDefault(); // 기본 배너를 막고 우리 버튼으로 대체
      setDeferred(event as BeforeInstallPromptEvent);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setMode('hidden');
  }, []);

  const install = useCallback(() => {
    if (!deferred) return;
    void deferred.prompt().then(() => {
      // 한 번 쓴 이벤트는 재사용할 수 없다 — 결과와 무관하게 배너를 닫는다
      setDeferred(null);
      setMode('hidden');
    });
  }, [deferred]);

  // 카톡 인앱 브라우저 탈출 — Android는 크롬을 직접 열 수 있고, iOS는 강제할 방법이 없어
  // 카카오 스킴을 시도하되 실패해도 아래 안내 문구가 남는다
  const openExternal = useCallback(() => {
    const { host, pathname, search, href } = window.location;
    if (/Android/i.test(navigator.userAgent)) {
      window.location.href = `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;end`;
      return;
    }
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  }, []);

  if (mode === 'hidden') return null;

  return (
    <div className="rounded-xl border border-court/40 bg-court/10 p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          {mode === 'kakao' && (
            <>
              <p className="text-sm font-medium text-court">브라우저로 열어주세요</p>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                카톡 안에서는 앱으로 설치할 수 없어요. 브라우저로 열면 홈 화면에 추가할 수
                있습니다.
              </p>
            </>
          )}
          {mode === 'android' && (
            <>
              <p className="text-sm font-medium text-court">앱으로 설치할 수 있어요</p>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                홈 화면에 추가하면 매번 링크를 찾지 않아도 됩니다.
              </p>
            </>
          )}
          {mode === 'ios' && (
            <>
              <p className="text-sm font-medium text-court">홈 화면에 추가하기</p>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                아래 공유 버튼 <span className="text-ink">⬆️</span> 을 누르고 목록에서{' '}
                <span className="text-ink">홈 화면에 추가</span> 를 선택하세요. 다음부터는
                아이콘으로 바로 들어올 수 있어요.
              </p>
            </>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="닫기"
          className="-mt-1 -mr-1 h-7 w-7 shrink-0 rounded-lg text-dim"
        >
          ✕
        </button>
      </div>

      {mode !== 'ios' && (
        <button
          onClick={mode === 'kakao' ? openExternal : install}
          className="mt-2 h-10 w-full rounded-lg bg-court text-sm font-bold text-bg"
        >
          {mode === 'kakao' ? '브라우저로 열기' : '홈 화면에 추가'}
        </button>
      )}
    </div>
  );
}
