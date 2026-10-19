'use client';

import { IAdminMemo } from '@letscok/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { ClearableInput } from '@/components/clearable-input';
import { ConfirmButton } from '@/components/confirm-button';
import { api } from '@/lib/api';

// 운영 메모 — 대기 인원 구역 아래 상시 노출

const TEMP_MEMO_PREFIX = 'temp-memo:';
// 마지막으로 받은 목록 — 여복·남복 사이를 오가면 보드를 새로 그리는데, 메모는 두 모임 공용이라 비었다가 채워지지 않게 바로 보여 준다
let lastMemos: IAdminMemo[] = [];

// 세션 무관 전역 메모 — 모임 종료에도 유지, 처리한 건 ✕(=완료), [초기화]는 2탭 확인.
// 운영진 전용 데이터라 공개 스냅샷에 없음 → 서버의 '메모 바뀜' 신호(version)가 올 때만 다시 읽는다
export function MemoPanel({
  version,
  run,
}: {
  version: number;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
}) {
  const [memos, setMemos] = useState<IAdminMemo[]>(() => lastMemos); // 서버 목록
  useEffect(() => {
    lastMemos = memos;
  }, [memos]);
  // 추가·삭제는 누르자마자 보이게 — 서버 응답이나 재조회를 기다리지 않는다. 재조회가 와도 이 표시는 남아 깜빡이지 않는다
  const [adding, setAdding] = useState<IAdminMemo[]>([]);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');

  const load = useCallback(async () => {
    try {
      setMemos(await api<IAdminMemo[]>('/memos', { admin: true }));
    } catch {
      // 조회 실패는 치명적이지 않음 — 다음 스냅샷 이벤트에서 재시도된다
    }
  }, []);
  // 처음과 '메모 바뀜' 신호마다 재조회 — 다른 운영진 기기의 메모 변경이 반영된다(예전엔 현황이 올 때마다 다시 읽었다)
  useEffect(() => {
    void load();
  }, [load, version]);
  // 재조회가 응답보다 먼저 와서 서버 목록에 이미 실렸으면 임시 메모는 숨긴다(같은 글이 두 줄로 보이지 않게)
  const view = [
    ...memos.filter((m) => !removing.has(m.id)),
    ...adding.filter((t) => !memos.some((m) => m.content === t.content)),
  ];

  const unmark = (ids: string[]) =>
    setRemoving((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

  const add = () => {
    const content = input.trim();
    if (!content) return;
    const temp: IAdminMemo = { id: `${TEMP_MEMO_PREFIX}${Date.now()}`, content, createdAt: new Date().toISOString() };
    setAdding((prev) => [...prev, temp]);
    setInput('');
    void run(async () => {
      try {
        const created = await api<IAdminMemo>('/memos', { method: 'POST', admin: true, body: { content } });
        setMemos((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
      } catch (error) {
        setInput((prev) => prev || content); // 실패 — 적은 글을 입력칸에 돌려준다(알림은 run)
        throw error;
      } finally {
        setAdding((prev) => prev.filter((t) => t.id !== temp.id));
      }
    });
  };

  const remove = (id: string) => {
    setRemoving((prev) => new Set(prev).add(id));
    void run(async () => {
      try {
        await api(`/memos/${id}`, { method: 'DELETE', admin: true });
        setMemos((prev) => prev.filter((m) => m.id !== id));
      } finally {
        unmark([id]);
      }
    });
  };

  const clearAll = () => {
    const ids = memos.map((m) => m.id);
    setRemoving((prev) => new Set([...prev, ...ids]));
    void run(async () => {
      try {
        await api('/memos/clear', { method: 'DELETE', admin: true });
        setMemos((prev) => prev.filter((m) => !ids.includes(m.id)));
      } finally {
        unmark(ids);
      }
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl bg-panel">
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-bold text-sky">
        메모
        <span className="tabular font-mono text-xs text-faint">{view.length}</span>
        {view.length > 0 && (
          <ConfirmButton
            label="초기화"
            confirmLabel="한 번 더 누르면 전체 삭제"
            onConfirm={clearAll}
            className="tap ml-auto h-7 rounded-lg border px-2.5 text-xs font-medium"
            idleCls="border-line text-dim"
            armedCls="border-coral bg-coral/15 text-coral"
          />
        )}
      </h2>
      {view.length > 0 && (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
          {view.map((memo) => (
            <li
              key={memo.id}
              className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">{memo.content}</span>
              <button
                onClick={() => remove(memo.id)}
                disabled={memo.id.startsWith(TEMP_MEMO_PREFIX)} // 아직 서버에 없는 메모는 지울 id가 없다
                title="완료 (삭제)"
                className="tap h-7 w-7 shrink-0 rounded-lg text-xs text-dim hover:text-coral"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 p-3">
        <ClearableInput
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          maxLength={200}
          placeholder="메모 — 모임 끝나도 유지돼요"
          className="h-10 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-court"
          onClear={() => setInput('')}
          wrapperClassName="min-w-0 flex-1"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="h-10 shrink-0 rounded-lg bg-court/10 px-3 text-sm font-medium text-court disabled:opacity-50"
        >
          추가
        </button>
      </div>
    </section>
  );
}
