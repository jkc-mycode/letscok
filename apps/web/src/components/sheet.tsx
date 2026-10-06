'use client';

import { motion, useDragControls, type PanInfo } from 'motion/react';
import { useEffect, useState } from 'react';
import { useBackClose } from '@/lib/back-stack';

// 공용 팝업 — 폰에서는 화면 아래에서 올라오는 시트, 넓은 화면(sm 이상)에서는 가운데 상자.
// 배경·닫기·뒤로가기·아이폰 안전 영역·접근성을 여기서 한 번에 처리한다(팝업마다 따로 짜지 않게).
//
// dismissible=false(입력 중인 팝업): 바깥 탭·끌어내리기로 닫히지 않고 [닫기]·뒤로가기로만 닫힌다
//   — 실수 한 번에 적던 내용이 날아가지 않게. 손잡이도 보여 주지 않는다

const CLOSE_DRAG_PX = 100; // 손잡이를 이만큼 끌어내리면(또는 빠르게 튕기면) 닫힌다
const CLOSE_VELOCITY = 500;

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
  dismissible?: boolean;
  layer?: 'z-40' | 'z-50'; // 다른 시트 위에 겹쳐 뜨면 z-50
  width?: string; // 넓은 화면에서의 최대 폭
  bodyClassName?: string;
  footer?: React.ReactNode; // 스크롤 밖 하단 고정(주요 버튼)
  children: React.ReactNode;
}) {
  useBackClose(onClose); // 안드로이드 뒤로가기 = 이 시트 닫기
  useBodyScrollLock();
  const phone = useIsPhone();
  const dragControls = useDragControls();

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > CLOSE_DRAG_PX || info.velocity.y > CLOSE_VELOCITY) onClose();
  };

  return (
    <div
      onClick={dismissible ? onClose : undefined}
      className={`fade-in fixed inset-0 ${layer} flex items-end justify-center bg-black/60 sm:items-center sm:p-4`}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        initial={phone ? { y: '100%' } : { y: 12, opacity: 0 }}
        animate={phone ? { y: 0 } : { y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        // 끌어내리기는 손잡이에서 시작할 때만(내용 스크롤과 구분), 위로는 못 끌고 아래로만 고무줄처럼
        drag={dismissible && phone ? 'y' : false}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        dragSnapToOrigin
        onDragEnd={onDragEnd}
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-panel px-5 pt-2 pb-safe-sheet sm:rounded-2xl sm:pt-5 ${width}`}
      >
        {dismissible && (
          <div
            onPointerDown={(e) => dragControls.start(e)}
            aria-hidden
            className="-mx-5 -mt-2 flex h-6 shrink-0 touch-none items-center justify-center sm:hidden"
          >
            <span className="h-1 w-10 rounded-full bg-line" />
          </div>
        )}
        <div className={`flex shrink-0 items-center gap-2 pb-3 ${dismissible ? '' : 'pt-3 sm:pt-0'}`}>
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
