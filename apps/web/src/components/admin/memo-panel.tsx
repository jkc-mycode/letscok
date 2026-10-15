'use client';

import { IAdminMemo, ISessionSnapshot } from '@letscok/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { ClearableInput } from '@/components/clearable-input';
import { api } from '@/lib/api';

// 운영 메모 — 대기 인원 구역 아래 상시 노출

// 세션 무관 전역 메모 — 모임 종료에도 유지, 처리한 건 ✕(=완료), [초기화]는 2탭 확인.
// 운영진 전용 데이터라 공개 스냅샷에 없음 → 스냅샷 이벤트를 재조회 트리거로만 사용
export function MemoPanel({
  snapshot,
  run,
  busy,
}: {
  snapshot: ISessionSnapshot;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
}) {
  const [memos, setMemos] = useState<IAdminMemo[]>([]);
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemos(await api<IAdminMemo[]>('/memos', { admin: true }));
    } catch {
      // 조회 실패는 치명적이지 않음 — 다음 스냅샷 이벤트에서 재시도된다
    }
  }, []);
  // 스냅샷이 바뀔 때마다 재조회 — 다른 운영진 기기의 메모 변경이 브로드캐스트를 타고 반영된다
  useEffect(() => {
    void load();
  }, [load, snapshot]);

  const add = () => {
    const content = input.trim();
    if (!content) return;
    void run(async () => {
      await api('/memos', { method: 'POST', admin: true, body: { content } });
      setInput('');
      await load();
    });
  };

  const remove = (id: string) =>
    run(async () => {
      await api(`/memos/${id}`, { method: 'DELETE', admin: true });
      await load();
    });

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000); // 4초 내 재탭 시 실행
      return;
    }
    setConfirmClear(false);
    void run(async () => {
      await api('/memos/clear', { method: 'DELETE', admin: true });
      await load();
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl bg-panel">
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-bold text-sky">
        메모
        <span className="tabular font-mono text-xs text-faint">{memos.length}</span>
        {memos.length > 0 && (
          <button
            onClick={clearAll}
            className={`tap ml-auto h-7 rounded-lg border px-2.5 text-xs font-medium ${
              confirmClear ? 'border-coral bg-coral/15 text-coral' : 'border-line text-dim'
            }`}
          >
            {confirmClear ? '한 번 더 누르면 전체 삭제' : '초기화'}
          </button>
        )}
      </h2>
      {memos.length > 0 && (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
          {memos.map((memo) => (
            <li
              key={memo.id}
              className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">{memo.content}</span>
              <button
                onClick={() => void remove(memo.id)}
                disabled={busy}
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
          disabled={!input.trim() || busy}
          className="h-10 shrink-0 rounded-lg bg-court/10 px-3 text-sm font-medium text-court disabled:opacity-50"
        >
          추가
        </button>
      </div>
    </section>
  );
}
