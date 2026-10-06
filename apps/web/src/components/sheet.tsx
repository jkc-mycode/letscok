'use client';

import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useBackClose } from '@/lib/back-stack';

// 공용 팝업 — 폰에서는 화면 아래에서 올라오는 시트, 넓은 화면(sm 이상)에서는 가운데 상자.
// 배경·닫기·뒤로가기·아이폰 안전 영역·접근성을 여기서 한 번에 처리한다(팝업마다 따로 짜지 않게).
//
// 닫는 방법(폰): [닫기] · 뒤로가기 · 아래로 끌어내리기 — 손잡이에서는 언제나, 내용 위에서는 내용이 맨 위까지 올라가 있을 때
// dismissible=false(입력 중인 팝업): 바깥 배경 탭으로만 닫히지 않는다 — 스치듯 한 번 눌러 적던 내용이 날아가지 않게.
//   끌어내리기는 일부러 하는 동작이라 입력 팝업에서도 허용한다

const CLOSE_DRAG_PX = 100; // 이만큼 끌어내리면 닫힌다
const CLOSE_FLICK_PX = 40; // 짧게 튕겨도 — 이만큼 이상 + 빠르게(아래 속도)면 닫는다
const CLOSE_VELOCITY = 700; // px/s
const LOCK_PX = 6; // 이만큼 움직인 뒤 방향을 정한다(세로로 내리기 vs 그 밖)
const SPRING = { type: 'spring', stiffness: 420, damping: 38 } as const;

// 폰 폭이면 아래에서 올라오고, 넓으면 살짝 떠오른다 — 첫 렌더 한 번만 판단
function useIsPhone() {
  const [phone] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(max-width: 639.98px)').matches,
  );
  return phone;
}

// 뒤 화면이 같이 스크롤되지 않게 — 겹쳐 열려도 이전 값을 되돌려 놓아 안쪽 시트가 닫혀도 잠금이 유지된다
function useBodyScrollLock() {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}

// 손가락 아래에서 세로로 스크롤되는 영역 — 그 영역이 맨 위가 아니면 끌어내리기 대신 스크롤
function findScroller(from: Element | null, stop: Element): HTMLElement | null {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el as HTMLElement;
    }
  }
  return null;
}

export function Sheet({
  header,
  ariaLabel,
  onClose,
  dismissible = true,
  layer = 'z-40',
  width = 'sm:max-w-md',
  bodyClassName = 'flex min-h-0 flex-1 flex-col gap-3 scroll-area',
  footer,
  children,
}: {
  header: React.ReactNode; // 제목 줄 왼쪽(제목·작은 설명) — [닫기]는 시트가 붙인다
  ariaLabel: string; // 화면 읽기 프로그램용 시트 이름
  onClose: () => void;
  dismissible?: boolean; // false = 바깥 배경 탭으로는 닫지 않음(입력 팝업)
  layer?: 'z-40' | 'z-50'; // 다른 시트 위에 겹쳐 뜨면 z-50
  width?: string; // 넓은 화면에서의 최대 폭
  bodyClassName?: string;
  footer?: React.ReactNode; // 스크롤 밖 하단 고정(주요 버튼)
  children: React.ReactNode;
}) {
  useBackClose(onClose); // 안드로이드 뒤로가기 = 이 시트 닫기
  useBodyScrollLock();
  const phone = useIsPhone();
  const panelRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0); // 시트의 세로 위치 — 올라오기·끌어내리기·제자리 복귀를 한 값으로
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 폰: 화면 아래에서 올라온다
  useEffect(() => {
    if (!phone) return;
    y.set(window.innerHeight);
    const controls = animate(y, 0, SPRING);
    return () => controls.stop();
  }, [phone, y]);

  // 폰: 아래로 끌어내리기 — 손잡이에서는 언제나, 내용 위에서는 내용이 맨 위일 때만(아니면 평소처럼 스크롤)
  useEffect(() => {
    const panel = panelRef.current;
    if (!phone || !panel) return;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let decided = false;
    let dragging = false;
    let fromHandle = false;
    let scroller: HTMLElement | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = performance.now();
      decided = false;
      dragging = false;
      const target = e.target as Element;
      fromHandle = !!target.closest('[data-sheet-handle]');
      scroller = findScroller(target, panel);
    };

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (!decided) {
        if (Math.abs(dy) < LOCK_PX && Math.abs(dx) < LOCK_PX) return;
        decided = true;
        dragging =
          dy > 0 && Math.abs(dy) > Math.abs(dx) && (fromHandle || !scroller || scroller.scrollTop <= 0);
      }
      if (!dragging) return;
      // 브라우저가 이미 스크롤을 시작했으면 막을 수 없다 — 그때는 끌기를 포기하고 스크롤에 맡긴다
      if (!e.cancelable) {
        dragging = false;
        animate(y, 0, SPRING);
        return;
      }
      e.preventDefault();
      y.set(Math.max(0, dy));
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const distance = y.get();
      const velocity = distance / Math.max(1, (performance.now() - startTime) / 1000);
      if (distance > CLOSE_DRAG_PX || (distance > CLOSE_FLICK_PX && velocity > CLOSE_VELOCITY)) {
        // 마저 내려보낸 뒤 닫는다(뚝 사라지지 않게)
        animate(y, window.innerHeight, { duration: 0.18, ease: 'easeIn' }).then(() => onCloseRef.current());
      } else {
        animate(y, 0, SPRING);
      }
    };

    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false }); // preventDefault로 스크롤 대신 끌기
    panel.addEventListener('touchend', onEnd);
    panel.addEventListener('touchcancel', onEnd);
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
    };
  }, [phone, y]);

  return (
    <div
      onClick={dismissible ? onClose : undefined}
      className={`fade-in fixed inset-0 ${layer} flex items-end justify-center bg-black/60 sm:items-center sm:p-4`}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        style={phone ? { y } : undefined}
        initial={phone ? false : { y: 12, opacity: 0 }}
        animate={phone ? undefined : { y: 0, opacity: 1 }}
        transition={SPRING}
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-panel px-5 pt-2 pb-safe-sheet sm:rounded-2xl sm:pt-5 ${width}`}
      >
        <div
          data-sheet-handle
          aria-hidden
          className="-mx-5 -mt-2 flex h-6 shrink-0 touch-none items-center justify-center sm:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
          <button
            onClick={onClose}
            className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>
        <div className={bodyClassName}>{children}</div>
        {footer && <div className="shrink-0 pt-3">{footer}</div>}
      </motion.div>
    </div>
  );
}
