'use client';

import { Gender, Grade } from '@letscok/shared-types';

export const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F'];

// 급수·성별 고르기 — 신규 등록·명단 수정·AI 게스트 등록 공용. 칸 배치는 쓰는 자리가 className으로 정한다
// surface: 놓인 면과 구분되는 쪽 — 시트 바탕이면 panel2, panel2 카드 안이면 panel
type Surface = 'panel' | 'panel2';
const OFF: Record<Surface, string> = { panel: 'bg-panel text-dim', panel2: 'bg-panel2 text-dim' };
const BUTTON = 'h-10 rounded-lg text-body-sm font-bold';

export function GradePicker({
  value,
  onChange,
  surface,
  className = 'grid grid-cols-6 gap-1.5',
}: {
  value: Grade | null | undefined;
  onChange: (grade: Grade) => void;
  surface: Surface;
  className?: string;
}) {
  return (
    <div className={className}>
      {GRADES.map((grade) => (
        <button
          key={grade}
          onClick={() => onChange(grade)}
          aria-pressed={value === grade}
          className={`${BUTTON} ${value === grade ? 'bg-court/15 text-court' : OFF[surface]}`}
        >
          {grade}
        </button>
      ))}
    </div>
  );
}

const GENDER_OPTIONS: { value: Gender; label: string; on: string }[] = [
  { value: 'MALE', label: '남', on: 'bg-sky/15 text-sky' },
  { value: 'FEMALE', label: '여', on: 'bg-pink/15 text-pink' },
];

export function GenderPicker({
  value,
  onChange,
  surface,
  className = 'grid grid-cols-2 gap-1.5',
  buttonClassName = '',
}: {
  value: Gender | null | undefined;
  onChange: (gender: Gender) => void;
  surface: Surface;
  className?: string;
  buttonClassName?: string; // 폭을 줄이는 자리(신규 등록 한 줄)
}) {
  return (
    <div className={className}>
      {GENDER_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`${BUTTON} ${buttonClassName} ${value === option.value ? option.on : OFF[surface]}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
