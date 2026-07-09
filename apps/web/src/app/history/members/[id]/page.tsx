'use client';

import { IHistoryMemberStats } from '@letscok/shared-types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { api, ApiError } from '@/lib/api';

export default function MemberStatsPage() {
  return (
    <AdminGate title="지난 모임 기록">
      <MemberStats />
    </AdminGate>
  );
}

function MemberStats() {
  const { id } = useParams<{ id: string }>();
  const [stats, setStats] = useState<IHistoryMemberStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<IHistoryMemberStats>(`/history/members/${id}`, { admin: true })
      .then(setStats)
      .catch((e) => setError(e instanceof ApiError ? e.message : '전적을 불러오지 못했습니다.'));
  }, [id]);

  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 p-6">
      <header>
        <Link href="/history" className="text-sm text-dim transition-opacity hover:opacity-70">
          ← 모임 목록
        </Link>
        {stats && (
          <div className="mt-1 flex items-center gap-2">
            <GradeBadge grade={stats.grade} />
            <h1 className="text-2xl font-bold">{stats.name}</h1>
            <GenderMarker gender={stats.gender} />
            {stats.isGuest && <span className="text-xs text-sky">게스트</span>}
          </div>
        )}
      </header>

      {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
      {!error && stats === null && (
        <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>
      )}

      {stats && (
        <>
          {/* 누적 요약 */}
          <section className="grid grid-cols-3 gap-2">
            {[
              { label: '총 출석', value: `${stats.totalSessions}회` },
              { label: '총 게임', value: `${stats.totalGames}판` },
              { label: '최근 출석', value: stats.lastAttendedDate ?? '없음' },
            ].map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel p-4"
              >
                <span className="text-xs text-faint">{item.label}</span>
                <span className="tabular text-center font-mono text-sm font-bold">
                  {item.value}
                </span>
              </div>
            ))}
          </section>

          <section>
            <h2 className="pb-2 text-sm font-bold text-court">함께 뛴 사람 top 5</h2>
            {stats.topPartners.length === 0 && (
              <p className="py-6 text-center text-sm text-faint">아직 함께 뛴 기록이 없어요</p>
            )}
            <div className="flex flex-col gap-2">
              {stats.topPartners.map((partner, index) => (
                <Link
                  key={partner.memberId}
                  href={`/history/members/${partner.memberId}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-court/50"
                >
                  <span className="w-4 text-center text-xs font-bold text-faint">{index + 1}</span>
                  <span className="font-medium">{partner.name}</span>
                  <span className="tabular ml-auto font-mono text-xs text-dim">
                    {partner.gamesTogether}게임
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="pb-2 text-sm font-bold text-amber">최근 모임</h2>
            {stats.recentSessions.length === 0 && (
              <p className="py-6 text-center text-sm text-faint">출석 기록이 없어요</p>
            )}
            <div className="flex flex-col gap-2">
              {stats.recentSessions.map((session) => (
                <div
                  key={session.date}
                  className="flex items-center rounded-xl border border-line bg-panel p-3 text-sm"
                >
                  <span className="font-medium">{session.date}</span>
                  <span className="tabular ml-auto font-mono text-xs text-dim">
                    {session.gamesPlayed}게임
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
