'use client';

import { IHistoryRankingEntry } from '@letscok/shared-types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { HistoryTabs } from '@/components/history-tabs';
import { api, ApiError } from '@/lib/api';

// 기간 필터 — months 값이 null이면 전체 누적
const PERIODS = [
  { label: '전체', months: null },
  { label: '1개월', months: 1 },
  { label: '3개월', months: 3 },
] as const;

type SortKey = 'sessions' | 'games';

export default function RankingPage() {
  return (
    <AdminGate title="지난 모임 기록">
      <Ranking />
    </AdminGate>
  );
}

function Ranking() {
  const [entries, setEntries] = useState<IHistoryRankingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('sessions');

  useEffect(() => {
    setEntries(null);
    setError(null);
    api<IHistoryRankingEntry[]>(
      `/history/ranking${months ? `?months=${months}` : ''}`,
      { admin: true },
    )
      .then(setEntries)
      .catch((e) => setError(e instanceof ApiError ? e.message : '랭킹을 불러오지 못했습니다.'));
  }, [months]);

  // 정렬 전환은 데이터가 통째로 와 있으므로 재요청 없이 클라이언트에서
  const sorted = useMemo(() => {
    if (!entries) return null;
    if (sortKey === 'sessions') return entries; // 서버 기본 정렬 = 출석순
    return [...entries].sort(
      (a, b) =>
        b.totalGames - a.totalGames ||
        b.totalSessions - a.totalSessions ||
        a.name.localeCompare(b.name, 'ko'),
    );
  }, [entries, sortKey]);

  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 p-6">
      <header>
        <Link href="/admin" className="text-sm text-dim transition-opacity hover:opacity-70">
          ← 관제판
        </Link>
        <h1 className="mt-1 text-2xl font-bold">참여 랭킹</h1>
        <p className="mt-1 text-xs text-faint">승패가 아니라 출석·게임 수 기준이에요</p>
      </header>

      <HistoryTabs current="ranking" />

      <div className="flex items-center gap-1.5">
        {PERIODS.map((period) => (
          <button
            key={period.label}
            onClick={() => setMonths(period.months)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium ${
              months === period.months ? 'border-court text-court' : 'border-line text-faint'
            }`}
          >
            {period.label}
          </button>
        ))}
        <button
          onClick={() => setSortKey((k) => (k === 'sessions' ? 'games' : 'sessions'))}
          className="ml-auto h-8 rounded-lg border border-amber/40 px-3 text-xs font-medium text-amber"
        >
          {sortKey === 'sessions' ? '출석순 ↓' : '게임순 ↓'}
        </button>
      </div>

      {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
      {!error && sorted === null && (
        <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>
      )}
      {sorted?.length === 0 && (
        <p className="py-10 text-center text-sm text-faint">등록된 모임원이 없어요</p>
      )}

      <div className="flex flex-col gap-2">
        {sorted?.map((entry, index) => (
          <Link
            key={entry.memberId}
            href={`/admin/history/members/${entry.memberId}`}
            className={`flex items-center gap-2 rounded-xl border bg-panel p-3 transition-colors hover:border-court/50 ${
              entry.totalSessions === 0 ? 'border-line opacity-60' : 'border-line'
            }`}
          >
            <span
              className={`w-6 shrink-0 text-center font-mono text-sm font-bold ${
                index < 3 && entry.totalSessions > 0 ? 'text-court' : 'text-faint'
              }`}
            >
              {index + 1}
            </span>
            <GradeBadge grade={entry.grade} />
            <span className="truncate font-medium">{entry.name}</span>
            <GenderMarker gender={entry.gender} />
            {entry.isGuest && <span className="shrink-0 text-[10px] text-sky">게스트</span>}
            <span className="tabular ml-auto shrink-0 text-right font-mono text-xs text-dim">
              출석 {entry.totalSessions}회 · 게임 {entry.totalGames}판
              {entry.lastAttendedDate && (
                <span className="block text-[10px] text-faint">
                  최근 {entry.lastAttendedDate}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
