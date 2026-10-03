'use client';

import { useEffect, useRef, useState } from 'react';
import { isInstalled } from '@/components/install-prompt';

// 안드로이드 뒤로가기(= history.back)를 앱 안 동작으로 바꾼다
// - 팝업이 열리면 기록을 한 칸 쌓고, 뒤로가기는 맨 위 팝업 하나만 닫는다(팝업 위 시트처럼 겹쳐도 한 번에 하나)
// - 팝업이 없는 첫 화면에선 "한 번 더 누르면 종료" (설치된 앱에서만 — 브라우저 탭의 뒤로가기는 건드리지 않는다)
//
// ⚠️ Next.js App Router도 popstate를 듣고, 자기 정보(__NA 등)가 없는 기록이면 페이지를 새로 불러온다
//    그래서 기록을 쌓을 때 현재 history.state를 그대로 복사하고 우리 표시만 덧붙인다

const DEPTH_KEY = '__letscokDepth'; // 이 기록이 팝업 몇 겹째인지 (0 = 팝업 없음)
const GUARD_KEY = '__letscokGuard'; // 종료 확인용 기록

interface Entry {
  depth: number;
  close: () => void;
}

const stack: Entry[] = []; // 열린 팝업, 아래→위
let listening = false;

function currentDepth(): number {
  return (window.history.state?.[DEPTH_KEY] as number | undefined) ?? 0;
}

function pushState(extra: Record<string, unknown>) {
  window.history.pushState({ ...window.history.state, ...extra }, '');
}

// 기록이 팝업 수보다 많이 쌓여 있으면(버튼으로 닫은 경우) 그만큼 되돌린다 — 닫기 여러 개가 겹쳐도 한 번에 맞춘다
let syncScheduled = false;
function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    const extra = currentDepth() - stack.length;
    if (extra > 0) window.history.go(-extra);
  });
}

// 뒤로가기로 기록이 줄면, 남은 기록 깊이보다 위에 있는 팝업을 닫는다
function onPopState() {
  const depth = currentDepth();
  while (stack.length > depth) {
    const top = stack.pop();
    top?.close();
  }
}

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

// 팝업 컴포넌트 안에서 호출 — 열려 있는 동안(active) 뒤로가기가 이 팝업을 닫는다
export function useBackClose(onClose: () => void, active = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    ensureListener();
    const entry: Entry = { depth: stack.length + 1, close: () => closeRef.current() };
    stack.push(entry);
    pushState({ [DEPTH_KEY]: entry.depth });
    return () => {
      // 버튼 등으로 닫힌 경우 — 스택에서 빼고 쌓아 둔 기록을 되돌린다 (뒤로가기로 닫혔으면 이미 빠져 있다)
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      scheduleSync();
    };
  }, [active]);
}

const EXIT_WINDOW_MS = 2000;

// 첫 화면(관제판·내 상태)에 둔다 — 팝업이 없을 때 뒤로가기를 누르면 안내만 띄우고,
// 2초 안에 한 번 더 누르면 그때 실제로 앱을 벗어난다. 안내 문구를 보여줄지 돌려준다
export function useExitGuard(): boolean {
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (!isInstalled()) return; // 브라우저 탭에선 뒤로가기를 가로채지 않는다
    // 같은 화면으로 돌아왔을 때 이미 가드가 있으면 또 쌓지 않는다
    if (!window.history.state?.[GUARD_KEY]) pushState({ [GUARD_KEY]: true, [DEPTH_KEY]: 0 });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onPop = () => {
      // 팝업을 닫은 뒤로가기면 여전히 가드 위에 있다 — 가드 자체가 빠졌을 때만 종료 확인
      if (window.history.state?.[GUARD_KEY] || stack.length > 0) return;
      setWarning(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // 2초 동안 더 안 눌렀으면 가드를 다시 세워 다음 뒤로가기도 막는다
        setWarning(false);
        if (!window.history.state?.[GUARD_KEY]) pushState({ [GUARD_KEY]: true, [DEPTH_KEY]: 0 });
      }, EXIT_WINDOW_MS);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return warning;
}
