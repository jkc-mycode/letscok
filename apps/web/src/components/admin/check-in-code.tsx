'use client';

import { ICheckInCodeResponse } from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api, ApiError } from '@/lib/api';

// 입장 코드 보기·바꾸기

// 모임원이 /checkin에서 입력하는 코드 — 소모임 공지사항의 작성월일(MMDD)에 맞춰 운영진이 관리
// 코드는 운영진 전용 엔드포인트에서 취득(공개 스냅샷엔 없음)
export function CheckInCodeModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null | undefined>(undefined); // undefined=로딩, null=코드없음
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ICheckInCodeResponse>('/sessions/current/checkin-code', { admin: true })
      .then((d) => setCode(d.code))
      .catch((e) => setError(e instanceof ApiError ? e.message : '코드를 불러오지 못했습니다.'));
  }, []);

  return (
    <Sheet
      ariaLabel="입장 코드"
      onClose={onClose}
      width="sm:max-w-sm"
      bodyClassName="flex min-h-0 flex-1 flex-col items-center gap-4 pb-2 text-center scroll-area"
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">입장 코드</h2>}
    >
      {error && <p className="py-8 text-sm text-coral">{error}</p>}
      {code === undefined && !error && <p className="py-8 text-sm text-dim">불러오는 중...</p>}
      {code === null && <p className="py-8 text-sm text-faint">이 모임엔 코드가 없어요(구 버전 세션)</p>}
      {code && (
        <>
          <div>
            <p className="tabular font-mono text-5xl font-bold tracking-[0.2em]">{code}</p>
            <p className="mt-2 text-xs leading-relaxed text-dim">
              모임원은 <b>[필독]공지사항</b>의 작성월일 4자리를 입력해요
            </p>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              미리 출석 처리해 둔 사람도 이 코드로 한 번 들어오면 폰이 연결돼 내 차례와 코트 알림을 받아요
            </p>
            <p className="mt-1 text-xs text-faint">공지를 새로 올렸다면 코드도 함께 바꿔주세요</p>
          </div>
          <CodeEditor current={code} onChanged={setCode} />
        </>
      )}
    </Sheet>
  );
}

// 코드 변경 — 공지사항 작성월일(MMDD)로 맞춘다. 바꾼 값은 다음 모임에도 승계되므로
// 공지를 새로 올릴 때만 손대면 된다 (코드는 방어선이 아니고 콕 확인이 게이트)
function CodeEditor({
  current,
  onChanged,
}: {
  current: string;
  onChanged: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => {
          setDraft(current);
          setError(null);
          setOpen(true);
        }}
        className="tap text-xs text-dim underline underline-offset-4"
      >
        코드 변경
      </button>
    );
  }

  const save = async () => {
    if (busy || draft.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ICheckInCodeResponse>('/sessions/current/checkin-code', {
        method: 'PATCH',
        admin: true,
        body: { code: draft },
      });
      if (res.code) onChanged(res.code);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '코드를 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        placeholder="공지 작성월일 4자리 (예: 0715)"
        autoComplete="off"
        className="tabular h-12 w-full rounded-lg border-2 border-transparent bg-panel2 text-center font-mono text-lg tracking-[0.2em] outline-none placeholder:font-sans placeholder:text-xs placeholder:tracking-normal focus:border-court"
      />
      <p className="text-caption leading-relaxed text-faint">
        바꾼 코드는 다음 모임에도 그대로 이어져요 — 공지를 새로 올릴 때만 바꾸면 돼요
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="h-11 flex-1 rounded-lg bg-panel2 text-sm text-dim"
        >
          취소
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || draft.length !== 4}
          className="h-11 flex-1 rounded-lg bg-court text-sm font-bold text-bg disabled:bg-panel2 disabled:text-faint"
        >
          저장
        </button>
      </div>
      {error && <p className="text-xs text-coral">{error}</p>}
    </div>
  );
}
