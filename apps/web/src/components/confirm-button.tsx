'use client';

import { useEffect, useRef, useState } from 'react';

// 두 번 눌러 확정하는 버튼 — 첫 탭은 문구만 바뀌고 3초 안에 다시 눌러야 실행된다(눌러둔 채 잊는 실수 방지)
// 관제판·모임원 화면 공용. 삭제·종료처럼 되돌리기 어려운 동작은 전부 이 버튼으로
export function ConfirmButton({
  label,
  confirmLabel = '한 번 더',
  title,
  className,
  idleCls,
  armedCls = 'border border-coral bg-coral/15 font-bold text-coral',
  disabled = false,
  onConfirm,
}: {
  label: React.ReactNode;
  confirmLabel?: React.ReactNode;
  title?: string;
  className: string; // 크기·모양만 — 색은 상태별로 갈린다
  idleCls: string;
  armedCls?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation(); // 줄 전체가 버튼인 명단 안에서도 줄 동작이 같이 눌리지 않게
        if (timer.current) clearTimeout(timer.current);
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      disabled={disabled}
      title={title}
      className={`${className} ${armed ? armedCls : idleCls}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
