'use client';

import { Gender, Grade, IMember } from '@letscok/shared-types';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { ClearableInput } from '@/components/clearable-input';
import { AlertIcon } from '@/components/icons';
import { formatBirthInput, parseBirthDate } from '@/lib/birth-input';

// 여러 명 신규 등록 폼 — 한 사람씩 카드, [+ 한 명 더]로 카드를 늘려 한 번에 등록한다
// 수동 체크인(등록+체크인, 기본 게스트)과 모임원 관리(등록만, 기본 모임원)가 같이 쓴다

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
  birthUnknown: boolean; // 생년월일 모름 — 비워 두고 나중에 모임원 관리에서 채운다
  grade: Grade | null;
  gender: Gender | null;
  error: string | null; // 서버가 거절한 이유(중복 등) — 이 카드만 남겨 고쳐서 다시 보내게
}

// 게스트는 생년월일을 받지 않는다(정책). 모임원은 올바른 8자리 날짜이거나 [모름]
function toBody(row: Row): NewMemberBody | null {
  const name = row.name.trim();
  if (!name || !row.grade || !row.gender) return null;
  if (row.isGuest) return { name, grade: row.grade, gender: row.gender, isGuest: true };
  if (row.birthUnknown) return { name, grade: row.grade, gender: row.gender, isGuest: false };
  const birthDate = parseBirthDate(row.birth);
  if (!birthDate) return null;
  return { name, birthDate, grade: row.grade, gender: row.gender, isGuest: false };
}

// 생년월일 없이 모임원을 만들 땐 같은 이름이 있으면 안 된다(서버도 409) — 미리 막고 이유를 보여 준다
const blockedByName = (row: Row, sameName: boolean) => !row.isGuest && row.birthUnknown && sameName;

export function MultiMemberForm({
  defaultGuest,
  initialName = '',
  actionLabel,
  register,
  pickExisting,
  onFinished,
}: {
  defaultGuest: boolean;
  initialName?: string;
  actionLabel: string; // 버튼 문구 — "등록" / "등록 + 체크인"
  register: (body: NewMemberBody) => Promise<void>; // 한 명 처리 — 실패하면 throw
  // 비슷한 이름 목록에서 기존 사람을 바로 처리(수동 체크인: 그 사람 체크인) — 없으면 목록은 보기만
  pickExisting?: { label: string; action: (member: IMember) => Promise<void> };
  onFinished: (doneNames: string[], remaining: number) => void; // remaining = 실패해서 남은 카드 수
}) {
  const nextKey = useRef(1);
  const newRow = (isGuest: boolean, name = ''): Row => ({
    key: nextKey.current++,
    isGuest,
    name,
    birth: '',
    birthUnknown: false,
    grade: null,
    gender: null,
    error: null,
  });
  const [rows, setRows] = useState<Row[]>(() => [newRow(defaultGuest, initialName)]);
  const [sameName, setSameName] = useState<Record<number, boolean>>({}); // 카드별 "이름이 똑같은 사람 있음"
  const [submitting, setSubmitting] = useState(false);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch, error: null } : row)));
  const remove = (key: number) =>
    setRows((prev) => {
      const next = prev.filter((row) => row.key !== key);
      return next.length > 0 ? next : [newRow(defaultGuest)];
    });
  // 새 카드는 직전 카드의 구분(게스트/모임원)을 따라간다 — 보통 같은 종류를 몰아서 등록한다
  const addRow = () => setRows((prev) => [...prev, newRow(prev.at(-1)?.isGuest ?? defaultGuest)]);

  const blocked = rows.some((row) => blockedByName(row, !!sameName[row.key]));
  const ready = rows.length > 0 && !blocked && rows.every((row) => toBody(row) !== null);

  // 서버 엔드포인트가 1명 단위라 순차 처리 — 성공한 카드는 지우고 실패한 카드만 이유와 함께 남긴다
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

  const pick = pickExisting
    ? async (row: Row, member: IMember) => {
        try {
          await pickExisting.action(member);
          remove(row.key);
          onFinished([member.name], 0);
        } catch (e) {
          setRows((prev) =>
            prev.map((r) =>
              r.key === row.key ? { ...r, error: e instanceof ApiError ? e.message : '요청에 실패했어요.' } : r,
            ),
          );
        }
      }
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <RowCard
          key={row.key}
          row={row}
          index={rows.length > 1 ? index + 1 : null}
          update={(patch) => update(row.key, patch)}
          onRemove={rows.length > 1 ? () => remove(row.key) : undefined}
          onSameName={(same) => setSameName((prev) => (prev[row.key] === same ? prev : { ...prev, [row.key]: same }))}
          blocked={blockedByName(row, !!sameName[row.key])}
          pickLabel={pickExisting?.label}
          onPick={pick ? (member) => void pick(row, member) : undefined}
        />
      ))}

      <button
        onClick={addRow}
        disabled={submitting}
        className="tap h-12 rounded-xl text-body-sm font-medium text-dim disabled:opacity-50"
      >
        + 한 명 더
      </button>
      <button
        onClick={() => void submit()}
        disabled={!ready || submitting}
        className="tap h-13 rounded-xl bg-court text-body font-bold text-bg disabled:bg-line disabled:text-faint"
      >
        {submitting
          ? '처리하는 중…'
          : blocked
            ? '같은 이름이 있어 등록할 수 없어요'
            : `${rows.length}명 ${actionLabel}`}
      </button>
      {!ready && !blocked && (
        <p className="text-center text-caption text-faint">
          이름, 급수, 성별을 고르고 모임원은 생년월일(모르면 [모름])까지 넣으면 등록할 수 있어요
        </p>
      )}
    </div>
  );
}

function RowCard({
  row,
  index,
  update,
  onRemove,
  onSameName,
  blocked,
  pickLabel,
  onPick,
}: {
  row: Row;
  index: number | null; // 카드가 여러 장일 때만 번호
  update: (patch: Partial<Row>) => void;
  onRemove?: () => void;
  onSameName: (same: boolean) => void;
  blocked: boolean;
  pickLabel?: string;
  onPick?: (member: IMember) => void;
}) {
  const matches = useSimilarMembers(row.name);
  const trimmed = row.name.trim();
  const exact = matches.filter((m) => m.name === trimmed);
  const hasExact = exact.length > 0;
  // 똑같은 이름을 먼저, 그다음 포함된 이름 — 너무 길어지지 않게 5명까지
  const shown = [...exact, ...matches.filter((m) => m.name !== trimmed)].slice(0, 5);

  const onSameNameRef = useRef(onSameName);
  onSameNameRef.current = onSameName;
  useEffect(() => onSameNameRef.current(hasExact), [hasExact]);

  const birthDigits = row.birth.replace(/\D/g, '');

  return (
    <div className={`flex flex-col gap-3.5 rounded-2xl p-3.5 ${row.error ? 'bg-coral/10' : 'bg-panel2'}`}>
      <div className="flex items-center gap-2">
        {index !== null && <span className="tabular w-5 shrink-0 text-center font-mono text-caption text-faint">{index}</span>}
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-panel p-1">
          <button
            onClick={() => update({ isGuest: false })}
            aria-pressed={!row.isGuest}
            className={`h-9 rounded-lg text-body-sm ${!row.isGuest ? 'bg-court/15 font-bold text-court' : 'text-dim'}`}
          >
            모임원
          </button>
          <button
            onClick={() => update({ isGuest: true })}
            aria-pressed={row.isGuest}
            className={`h-9 rounded-lg text-body-sm ${row.isGuest ? 'bg-sky/15 font-bold text-sky' : 'text-dim'}`}
          >
            게스트
          </button>
        </div>
        {onRemove && (
          <button onClick={onRemove} aria-label="이 사람 빼기" className="tap h-11 w-11 shrink-0 rounded-xl text-dim hover:text-coral">
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-bold text-dim">이름</span>
        <ClearableInput
          autoComplete="off"
          aria-label="이름"
          value={row.name}
          onChange={(e) => update({ name: e.target.value })}
          maxLength={20}
          placeholder="이름"
          className={`h-12 rounded-xl border-2 bg-panel px-3.5 text-body outline-none placeholder:text-faint ${
            hasExact ? 'border-amber' : 'border-transparent focus:border-court'
          }`}
          onClear={() => update({ name: '' })}
        />
        {shown.length > 0 && (
          <div className={`flex flex-col gap-1 rounded-xl px-3 py-2.5 ${hasExact ? 'bg-amber/10' : 'bg-panel'}`}>
            <span className={`flex items-center gap-1.5 text-caption font-bold ${hasExact ? 'text-amber' : 'text-faint'}`}>
              {hasExact && <AlertIcon size={14} />}
              {hasExact ? '같은 이름이 이미 있어요 — 같은 사람인지 확인해 주세요' : '이름이 비슷한 사람'}
            </span>
            {shown.map((m) => (
              <div key={m.id} className="flex min-h-9 items-center gap-2 text-body-sm">
                <GradeBadge grade={m.grade} />
                <span className={m.name === trimmed ? 'font-medium' : 'text-dim'}>{m.name}</span>
                <GenderMarker gender={m.gender} />
                <span className={`text-caption ${m.isGuest ? 'text-sky' : 'tabular font-mono text-faint'}`}>
                  {m.isGuest ? '게스트' : (m.birthDate ?? '생년월일 없음')}
                </span>
                {onPick && (
                  <button
                    onClick={() => onPick(m)}
                    className="tap ml-auto h-9 shrink-0 rounded-lg bg-court/15 px-3 text-caption font-bold text-court"
                  >
                    {pickLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-bold text-dim">급수와 성별</span>
        <div className="flex gap-1.5">
          <div className="grid flex-1 grid-cols-6 gap-1">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => update({ grade: g })}
                aria-pressed={row.grade === g}
                className={`h-10 rounded-lg text-body-sm font-bold ${
                  row.grade === g ? 'bg-court/15 text-court' : 'bg-panel text-dim'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-1">
            <button
              onClick={() => update({ gender: 'MALE' })}
              aria-pressed={row.gender === 'MALE'}
              className={`h-10 w-11 rounded-lg text-body-sm font-bold ${
                row.gender === 'MALE' ? 'bg-sky/15 text-sky' : 'bg-panel text-dim'
              }`}
            >
              남
            </button>
            <button
              onClick={() => update({ gender: 'FEMALE' })}
              aria-pressed={row.gender === 'FEMALE'}
              className={`h-10 w-11 rounded-lg text-body-sm font-bold ${
                row.gender === 'FEMALE' ? 'bg-pink/15 text-pink' : 'bg-panel text-dim'
              }`}
            >
              여
            </button>
          </div>
        </div>
      </div>

      {!row.isGuest && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-bold text-dim">생년월일</span>
          <div className="flex gap-1.5">
            <ClearableInput
              autoComplete="off"
              aria-label="생년월일"
              type="text"
              inputMode="numeric"
              value={row.birth}
              disabled={row.birthUnknown}
              onChange={(e) => update({ birth: formatBirthInput(e.target.value) })}
              placeholder={row.birthUnknown ? '모름 — 나중에 채워요' : '8자리 (예: 19970312)'}
              className="tabular h-12 rounded-xl border-2 border-transparent bg-panel px-3.5 font-mono text-body outline-none placeholder:font-sans placeholder:text-faint focus:border-court disabled:opacity-50"
              onClear={() => update({ birth: '' })}
              wrapperClassName="min-w-0 flex-1"
            />
            <button
              onClick={() => update({ birthUnknown: !row.birthUnknown, birth: '' })}
              aria-pressed={row.birthUnknown}
              className={`tap h-12 shrink-0 rounded-xl px-4 text-body-sm font-bold ${
                row.birthUnknown ? 'bg-court/15 text-court' : 'bg-panel text-dim'
              }`}
            >
              {row.birthUnknown && '✓ '}모름
            </button>
          </div>
          {birthDigits.length === 8 && !parseBirthDate(row.birth) && (
            <p className="text-caption text-coral">날짜가 올바르지 않아요</p>
          )}
          {row.birthUnknown && (
            <p className={`text-caption ${blocked ? 'font-medium text-coral' : 'text-faint'}`}>
              {blocked
                ? '같은 이름이 있으면 생년월일 없이는 구분할 수 없어요. 생년월일을 넣어 주세요.'
                : '나중에 모임원 관리에서 채울 수 있어요. 같은 이름이 있으면 생년월일 없이는 등록할 수 없어요.'}
            </p>
          )}
        </div>
      )}

      {row.error && <p className="text-caption font-medium text-coral">{row.error}</p>}
    </div>
  );
}

// 이름을 치는 동안 이미 등록된 비슷한 이름(같거나 포함, 삭제 제외)을 찾는다 — 300ms 멈추면 한 번
function useSimilarMembers(name: string): IMember[] {
  const [matches, setMatches] = useState<IMember[]>([]);
  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setMatches([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api<IMember[]>(`/members/search?name=${encodeURIComponent(trimmed)}`, { admin: true }) // 운영진 화면 전용 폼 — 전체 생년월일
        .then((list) => alive && setMatches(list))
        .catch(() => alive && setMatches([]));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [name]);
  return matches;
}
