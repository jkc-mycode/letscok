'use client';

import { IHistorySessionListResponse } from '@letscok/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { HistoryTabs } from '@/components/history-tabs';
import { HomeLink } from '@/components/home-link';
import { api, ApiError } from '@/lib/api';

const PAGE_SIZE = 20;

export default function HistoryPage() {
  return (
    <AdminGate title="지난 모임 기록">
      <HistoryList />
    </AdminGate>
  );
}

function HistoryList() {
  const [data, setData] = useState<IHistorySessionListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setData(null);
    setError(null);
    api<IHistorySessionListResponse>(`/history/sessions?page=${page}&limit=${PAGE_SIZE}`, {
      admin: true,
    })
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : '기록을 불러오지 못했습니다.'));
  }, [page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 p-6">
      <header>
        <HomeLink className="text-sm font-medium tracking-[0.3em] text-court transition-opacity hover:opacity-70">
          LETSCOK
        </HomeLink>
        <h1 className="mt-1 text-2xl font-bold">지난 모임 기록</h1>
        {data && <p className="mt-1 text-sm text-dim">총 {data.total}번의 모임</p>}
      </header>

      <HistoryTabs current="sessions" />

      {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
      {!error && data === null && <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>}
      {data?.sessions.length === 0 && (
        <p className="py-10 text-center text-sm text-faint">아직 종료된 모임이 없어요</p>
      )}

      <div className="flex flex-col gap-2">
        {data?.sessions.map((session) => (
          <Link
            key={session.id}
            href={`/admin/history/${session.id}`}
            className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4 transition-colors hover:border-court/50"
          >
            <span className="font-bold">{session.date}</span>
            <span className="ml-auto text-sm text-dim">
              출석 {session.attendeeCount}명 · 게임 {session.finishedGameCount}판
            </span>
          </Link>
        ))}
      </div>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page <= 1}
            className="h-10 rounded-lg border border-line px-4 text-sm text-dim disabled:opacity-30"
          >
            이전
          </button>
          <span className="tabular font-mono text-sm text-faint">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
            className="h-10 rounded-lg border border-line px-4 text-sm text-dim disabled:opacity-30"
          >
            다음
          </button>
        </div>
      )}
    </main>
  );
}
