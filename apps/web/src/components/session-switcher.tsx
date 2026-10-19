'use client';

import { IOpenSessionBrief } from '@letscok/shared-types';
import { useState } from 'react';

// 여복·남복처럼 동시에 연 모임 사이를 오가는 칩 — 관제판·전광판 공용. 모임이 하나면 아무것도 안 그린다

// 이름 없이 연 모임(보통 먼저 연 쪽)은 연 순서로 부른다
export function sessionName(sessions: IOpenSessionBrief[], id: string): string {
  const index = sessions.findIndex((s) => s.id === id);
  return sessions[index]?.label ?? `${index + 1}번 모임`;
}

export function SessionSwitcher({
  sessions,
  currentId,
  onSelect,
  className = '',
}: {
  sessions: IOpenSessionBrief[];
  currentId: string;
  onSelect: (id: string) => Promise<void>;
  className?: string;
}) {
  // 누른 칩은 바로 켜고 응답이 올 때까지 작게 돌린다 — 보드는 새 현황이 와야 바뀌어서, 느릴 땐 안 눌린 줄 알고 또 눌렀다
  const [pendingId, setPendingId] = useState<string | null>(null);
  if (sessions.length < 2) return null;
  const select = (id: string) => {
    setPendingId(id);
    void onSelect(id).finally(() => setPendingId(null));
  };
  const shownId = pendingId ?? currentId;
  return (
    <div role="tablist" aria-label="모임 바꾸기" className={`flex shrink-0 gap-1.5 overflow-x-auto ${className}`}>
      {sessions.map((s) => {
        const current = s.id === shownId;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={current}
            aria-busy={pendingId === s.id}
            onClick={() => !current && select(s.id)}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-body-sm font-bold ${
              current ? 'bg-court text-bg' : 'bg-panel text-dim'
            }`}
          >
            {sessionName(sessions, s.id)}
            {pendingId === s.id && (
              <svg className="shrink-0 animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
