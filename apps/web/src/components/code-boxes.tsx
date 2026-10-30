'use client';

import { useState } from 'react';

// 코드 입력 — 실제 입력칸은 하나(붙여넣기·자동 채우기·지우기가 평소처럼 동작), 보이는 모양만 4칸
// 투명한 입력칸을 4칸 위에 겹쳐 두고, 칸마다 숫자를 그린다. 지금 입력할 칸은 초록 테두리
// 틀린 값은 서버가 막으므로 여기선 형식(숫자 4자리)만 맞춘다
// id: 한 화면에 둘 이상 뜰 수 있어 label 연결용 id를 받는다
export function CodeBoxes({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={id} className="text-body-sm font-bold text-dim">
        입장 코드
      </label>
      <div className="relative">
        <div className="grid grid-cols-4 gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => {
            const active = focused && (i === value.length || (i === 3 && value.length === 4));
            return (
              <span
                key={i}
                className={`tabular flex h-15 items-center justify-center rounded-xl bg-panel font-mono text-[1.625rem] font-semibold transition-shadow ${
                  active ? 'ring-2 ring-court' : ''
                }`}
              >
                {value[i] ?? ''}
              </span>
            );
          })}
        </div>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          aria-label="입장 코드 4자리"
          className="absolute inset-0 h-full w-full cursor-pointer text-transparent caret-transparent opacity-0"
        />
      </div>
      <p className="text-caption text-faint">소모임 [필독]공지사항의 작성월일 4자리예요</p>
    </div>
  );
}
