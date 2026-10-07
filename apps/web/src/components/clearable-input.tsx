'use client';

import { useRef } from 'react';

// 입력칸 + 오른쪽 ✕(한 번에 지우기) — 글자가 있을 때만 보이고, 지운 뒤에도 입력칸에 커서를 둔다(이어서 바로 입력)
// 바깥 배치(flex-1·min-w-0·여백)는 wrapperClassName으로, 입력칸 모양은 className으로 준다
// 숫자 몇 자리 칸(코드·코트 번호·금액·날짜)과 패스코드에는 쓰지 않는다

const CLEAR_BUTTON =
  'absolute flex h-7 w-7 items-center justify-center rounded-full bg-line text-dim hover:text-ink';

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ClearableInput({
  value,
  onClear,
  wrapperClassName = '',
  className = '',
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'> & {
  value: string;
  onClear: () => void;
  wrapperClassName?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const showClear = value !== '' && !rest.disabled && !rest.readOnly;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input ref={ref} value={value} className={`w-full ${className} ${showClear ? 'pr-11' : ''}`} {...rest} />
      {showClear && (
        <button
          type="button"
          aria-label="입력 지우기"
          // 누르는 순간 입력칸 포커스가 빠지지 않게(폰 키보드가 내려갔다 올라오지 않게)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClear();
            ref.current?.focus();
          }}
          className={`${CLEAR_BUTTON} top-1/2 right-2 -translate-y-1/2`}
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}

// 여러 줄 입력칸 — ✕는 오른쪽 위
export function ClearableTextarea({
  value,
  onClear,
  wrapperClassName = '',
  className = '',
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string;
  onClear: () => void;
  wrapperClassName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const showClear = value !== '' && !rest.disabled && !rest.readOnly;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <textarea ref={ref} value={value} className={`w-full ${className} ${showClear ? 'pr-11' : ''}`} {...rest} />
      {showClear && (
        <button
          type="button"
          aria-label="입력 지우기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClear();
            ref.current?.focus();
          }}
          className={`${CLEAR_BUTTON} top-2 right-2`}
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}
