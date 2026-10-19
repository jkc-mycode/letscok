'use client';

import { IOpenSessionBrief } from '@letscok/shared-types';

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
  onSelect: (id: string) => void;
  className?: string;
}) {
  if (sessions.length < 2) return null;
  return (
    <div role="tablist" aria-label="모임 바꾸기" className={`flex shrink-0 gap-1.5 overflow-x-auto ${className}`}>
      {sessions.map((s) => {
        const current = s.id === currentId;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={current}
            onClick={() => !current && onSelect(s.id)}
            className={`h-9 shrink-0 rounded-full px-4 text-body-sm font-bold ${
              current ? 'bg-court text-bg' : 'bg-panel text-dim'
            }`}
          >
            {sessionName(sessions, s.id)}
          </button>
        );
      })}
    </div>
  );
}
