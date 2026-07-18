'use client';

import { IHistorySessionDetail } from '@letscok/shared-types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { api, ApiError } from '@/lib/api';

export default function HistoryDetailPage() {
  return (
    <AdminGate title="지난 모임 기록">
      <HistoryDetail />
    </AdminGate>
  );
}

// "11:20" — 게임 시각은 그날 안에서만 의미 있으므로 시:분만
function timeLabel(iso: string | null) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function HistoryDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<IHistorySessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<IHistorySessionDetail>(`/history/sessions/${id}`, { admin: true })
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? e.message : '기록을 불러오지 못했습니다.'));
  }, [id]);

  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 p-6">
      <header>
        <Link href="/history" className="text-sm text-dim transition-opacity hover:opacity-70">
          ← 모임 목록
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{detail?.session.date ?? '모임 상세'}</h1>
        {detail && (
          <p className="mt-1 text-sm text-dim">
            출석 {detail.session.attendeeCount}명 · 게임 {detail.session.finishedGameCount}판
          </p>
        )}
      </header>

      {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
      {!error && detail === null && (
        <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>
      )}

      {detail && (
        <>
          <section>
            <h2 className="pb-2 text-sm font-bold text-court">출석자</h2>
            <div className="flex flex-col gap-2">
              {detail.attendees.map((attendee) => (
                <Link
                  key={attendee.memberId}
                  href={`/history/members/${attendee.memberId}`}
                  className="flex items-center gap-2 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-court/50"
                >
                  <GradeBadge grade={attendee.grade} />
                  <span className="font-medium">{attendee.name}</span>
                  <GenderMarker gender={attendee.gender} />
                  {attendee.isGuest && <span className="text-[10px] text-sky">게스트</span>}
                  <span className="tabular ml-auto font-mono text-xs text-dim">
                    {attendee.gamesPlayed}게임
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="pb-2 text-sm font-bold text-amber">게임 기록</h2>
            {detail.games.length === 0 && (
              <p className="py-6 text-center text-sm text-faint">완료된 게임이 없어요</p>
            )}
            <div className="flex flex-col gap-2">
              {detail.games.map((game, index) => (
                <div key={game.id} className="rounded-xl border border-line bg-panel p-3">
                  <div className="flex items-center gap-2 text-xs text-dim">
                    <span className="font-bold text-amber">{index + 1}</span>
                    <span>{game.courtNo ? `${game.courtNo}번 코트` : '코트 미상'}</span>
                    <span className="tabular ml-auto font-mono">
                      {timeLabel(game.startedAt)} ~ {timeLabel(game.endedAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium">
                    {game.players.map((player, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <GradeBadge grade={player.grade} />
                        {player.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
