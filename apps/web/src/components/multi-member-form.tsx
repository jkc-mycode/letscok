'use client';

import { Gender, Grade } from '@letscok/shared-types';
import { useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ClearableInput } from '@/components/clearable-input';
import { formatBirthInput, parseBirthDate } from '@/lib/birth-input';

// 여러 명 신규 등록 폼 — 한 줄에 한 사람, [+ 한 명 더]로 줄을 늘려 한 번에 등록한다
// 수동 체크인(등록+체크인, 기본 게스트)과 모임원 관리(등록만, 기본 정회원)가 같이 쓴다

export const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface NewMemberBody {
  name: string;
  birthDate?: string;
  grade: Grade;
  gender: Gender;
  isGuest: boolean;
}

interface Row {
  key: number;
  isGuest: boolean;
  name: string;
  birth: string;
  grade: Grade | null;
  gender: Gender | null;
  error: string | null; // 서버가 거절한 이유(중복 등) — 이 줄만 남겨 고쳐서 다시 보내게
}

// 게스트는 생년월일을 받지 않는다(정책). 정회원은 8자리가 올바른 날짜여야 한다
function toBody(row: Row): NewMemberBody | null {
  const name = row.name.trim();
  if (!name || !row.grade || !row.gender) return null;
  if (row.isGuest) return { name, grade: row.grade, gender: row.gender, isGuest: true };
  const birthDate = parseBirthDate(row.birth);
  if (!birthDate) return null;
  return { name, birthDate, grade: row.grade, gender: row.gender, isGuest: false };
}

export function MultiMemberForm({
  defaultGuest,
  initialName = '',
  actionLabel,
  register,
  onFinished,
}: {
  defaultGuest: boolean;
  initialName?: string;
  actionLabel: string; // 버튼 문구 — "등록" / "등록 + 체크인"
  register: (body: NewMemberBody) => Promise<void>; // 한 명 처리 — 실패하면 throw
  onFinished: (doneNames: string[], remaining: number) => void; // remaining = 실패해서 남은 줄 수
}) {
  const nextKey = useRef(1);
  const newRow = (isGuest: boolean, name = ''): Row => ({
    key: nextKey.current++,
    isGuest,
    name,
    birth: '',
    grade: null,
    gender: null,
    error: null,
  });
  const [rows, setRows] = useState<Row[]>(() => [newRow(defaultGuest, initialName)]);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch, error: null } : row)));
  const remove = (key: number) => setRows((prev) => prev.filter((row) => row.key !== key));
  // 새 줄은 직전 줄의 구분(게스트/정회원)을 따라간다 — 보통 같은 종류를 몰아서 등록한다
  const addRow = () => setRows((prev) => [...prev, newRow(prev.at(-1)?.isGuest ?? defaultGuest)]);

  const ready = rows.length > 0 && rows.every((row) => toBody(row) !== null);

  // 서버 엔드포인트가 1명 단위라 순차 처리 — 성공한 줄은 지우고 실패한 줄만 이유와 함께 남긴다
  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    const done: string[] = [];
    const remaining: Row[] = [];
    for (const row of rows) {
      const body = toBody(row);
      if (!body) continue;
      try {
        await register(body);
        done.push(body.name);
      } catch (e) {
        remaining.push({ ...row, error: e instanceof ApiError ? e.message : '등록에 실패했어요.' });
      }
    }
    setRows(remaining.length > 0 ? remaining : [newRow(defaultGuest)]);
    setSubmitting(false);
    onFinished(done, remaining.length);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => {
        const birthDigits = row.birth.replace(/\D/g, '');
        return (
          <div
            key={row.key}
            className={`flex flex-col gap-1.5 rounded-xl border p-2.5 ${
              row.error ? 'border-coral/50 bg-coral/5' : 'border-line bg-panel2'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-xs text-faint">{index + 1}</span>
              <div className="flex shrink-0 overflow-hidden rounded-lg bg-panel2 text-xs font-bold">
                <button
                  onClick={() => update(row.key, { isGuest: false })}
                  className={`h-9 px-2.5 ${!row.isGuest ? 'bg-court/15 text-court' : 'text-dim'}`}
                >
                  정회원
                </button>
                <button
                  onClick={() => update(row.key, { isGuest: true })}
                  className={`h-9 px-2.5 ${row.isGuest ? 'bg-sky/15 text-sky' : 'text-dim'}`}
                >
                  게스트
                </button>
              </div>
              <ClearableInput
                autoComplete="off"
                value={row.name}
                onChange={(e) => update(row.key, { name: e.target.value })}
                maxLength={20}
                placeholder="이름"
                className="h-9 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-sky"
                onClear={() => update(row.key, { name: '' })}
                wrapperClassName="min-w-0 flex-1"
              />
              {rows.length > 1 && (
                <button
                  onClick={() => remove(row.key)}
                  title="이 줄 빼기"
                  className="h-9 w-8 shrink-0 text-dim hover:text-coral"
                >
                  ✕
                </button>
              )}
            </div>

            {!row.isGuest && (
              <ClearableInput
                autoComplete="off"
                type="text"
                inputMode="numeric"
                value={row.birth}
                onChange={(e) => update(row.key, { birth: formatBirthInput(e.target.value) })}
                placeholder="생년월일 8자리 (예: 19970312)"
                className="h-9 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-court"
                onClear={() => update(row.key, { birth: '' })}
              />
            )}
            {!row.isGuest && birthDigits.length === 8 && !parseBirthDate(row.birth) && (
              <p className="text-xs text-coral">날짜가 올바르지 않아요</p>
            )}

            <div className="flex gap-1.5">
              <div className="grid flex-1 grid-cols-6 gap-1">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    onClick={() => update(row.key, { grade: g })}
                    className={`h-9 rounded-lg border text-xs font-bold ${
                      row.grade === g ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel text-dim'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-1">
                <button
                  onClick={() => update(row.key, { gender: 'MALE' })}
                  className={`h-9 w-9 rounded-lg border text-sm font-bold ${
                    row.gender === 'MALE' ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel text-dim'
                  }`}
                >
                  ♂
                </button>
                <button
                  onClick={() => update(row.key, { gender: 'FEMALE' })}
                  className={`h-9 w-9 rounded-lg border text-sm font-bold ${
                    row.gender === 'FEMALE' ? 'border-pink bg-pink/15 text-pink' : 'border-line bg-panel text-dim'
                  }`}
                >
                  ♀
                </button>
              </div>
            </div>

            {row.error && <p className="text-xs font-medium text-coral">{row.error}</p>}
          </div>
        );
      })}

      <button
        onClick={addRow}
        disabled={submitting}
        className="h-10 rounded-xl border border-dashed border-line text-sm text-dim disabled:opacity-50"
      >
        + 한 명 더
      </button>
      <button
        onClick={() => void submit()}
        disabled={!ready || submitting}
        className="h-11 rounded-xl bg-sky text-sm font-bold text-bg disabled:opacity-50"
      >
        {submitting ? '처리하는 중…' : `${rows.length}명 ${actionLabel}`}
      </button>
      {!ready && rows.length > 0 && (
        <p className="text-center text-caption text-faint">
          모든 줄에 이름·급수·성별(정회원은 생년월일까지)을 넣으면 등록할 수 있어요
        </p>
      )}
    </div>
  );
}
