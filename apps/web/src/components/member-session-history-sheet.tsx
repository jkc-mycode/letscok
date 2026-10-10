'use client';

import type { Grade, IHistoryGamePlayer, IHistoryMemberGame, IHistoryMemberSessionPage } from '@letscok/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GradeBadge } from '@/components/badges';
import { Sheet } from '@/components/sheet';
import { api } from '@/lib/api';
import { timeLabel } from '@/lib/session-report';

const PAGE_SIZE = 50;

type Item = IHistoryMemberSessionPage['items'][number];
type DayGames = IHistoryMemberGame[] | 'loading' | 'error';

// me = 이 이력의 주인 — 같은 팀 줄 맨 왼쪽에 강조해서(4명이 다 보이게)
function Names({ players, me }: { players: IHistoryGamePlayer[]; me?: IHistoryGamePlayer }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {me && (
        <span className="flex items-center gap-1 font-bold text-court">
          <GradeBadge grade={me.grade} />
          {me.name}
        </span>
      )}
      {players.map((player, i) => (
        <span key={i} className="flex items-center gap-1">
          <GradeBadge grade={player.grade} />
          {player.name}
        </span>
      ))}
    </span>
  );
}

// 펼친 날짜의 게임들 — 판마다 코트·시간·같은 팀·상대
function DayGameList({ games, me, onRetry }: { games: DayGames; me: IHistoryGamePlayer; onRetry: () => void }) {
  if (games === 'loading') return <p className="py-2 text-center text-caption text-dim">불러오는 중...</p>;
  if (games === 'error') {
    return (
      <button onClick={onRetry} className="py-2 text-center text-caption text-coral">
        불러오지 못했어요 — 눌러서 다시 시도
      </button>
    );
  }
  if (games.length === 0) return <p className="py-2 text-center text-caption text-faint">완료된 게임이 없어요</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {games.map((game, index) => (
        <div key={game.id} className="rounded-lg bg-panel px-3 py-2">
          <div className="flex items-center gap-2 text-caption text-dim">
            <span className="font-bold text-amber">{index + 1}게임</span>
            <span>{game.courtNo ? `${game.courtNo}번 코트` : '코트 미상'}</span>
            <span className="tabular ml-auto font-mono">
              {timeLabel(game.startedAt)}~{timeLabel(game.endedAt)}
            </span>
          </div>
          {game.teamsKnown ? (
            <div className="mt-1 grid grid-cols-[3.5rem_1fr] gap-y-1 text-body-sm font-medium">
              <span className="text-caption text-court">같은 팀</span>
              <Names players={game.partners} me={me} />
              <span className="text-caption text-coral">상대</span>
              <Names players={game.opponents} />
            </div>
          ) : (
            // 자리(팀) 기능 전에 한 게임 — 팀을 몰라 함께 뛴 사람만
            <div className="mt-1 grid grid-cols-[3.5rem_1fr] text-body-sm font-medium">
              <span className="text-caption text-faint">함께</span>
              <Names players={game.partners} me={me} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 한 사람의 전체 출석 이력 — 최신순 50개씩, 목록 끝이 보이면 다음 쪽(모임원 관리 목록과 같은 무한 스크롤)
export function MemberSessionHistorySheet({
  memberId,
  name,
  grade,
  onClose,
}: {
  memberId: string;
  name: string;
  grade: Grade;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null); // null=첫 로딩
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 지금까지 받은 쪽 수
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null); // 펼친 날짜(모임) — 한 번에 하나
  const [dayGames, setDayGames] = useState<Map<string, DayGames>>(new Map()); // 한 번 받은 날은 다시 펼쳐도 그대로
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (next: number) => {
      setLoading(true);
      setError(false);
      try {
        const data = await api<IHistoryMemberSessionPage>(
          `/history/members/${memberId}/sessions?page=${next}&limit=${PAGE_SIZE}`,
          { admin: true },
        );
        setItems((prev) => (next === 1 ? data.items : [...(prev ?? []), ...data.items]));
        setTotal(data.total);
        setPage(next);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [memberId],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const hasMore = items !== null && items.length < total && !error;
  const loadMoreRef = useRef(() => {});
  loadMoreRef.current = () => {
    if (hasMore && !loading) void load(page + 1);
  };
  // 불러온 뒤에도 끝 표시가 아직 보이면(목록이 짧은 화면) 바로 한 번 더 — 다시 관찰을 걸면 즉시 알려 준다
  const loadedCount = items?.length ?? 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && loadMoreRef.current(),
      { root: listRef.current, rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadedCount]);

  const loadDay = (sessionId: string) => {
    setDayGames((prev) => new Map(prev).set(sessionId, 'loading'));
    api<IHistoryMemberGame[]>(`/history/members/${memberId}/sessions/${sessionId}/games`, { admin: true })
      .then((games) => setDayGames((prev) => new Map(prev).set(sessionId, games)))
      .catch(() => setDayGames((prev) => new Map(prev).set(sessionId, 'error')));
  };
  const toggleDay = (sessionId: string) => {
    if (openId === sessionId) {
      setOpenId(null);
      return;
    }
    setOpenId(sessionId);
    const known = dayGames.get(sessionId);
    if (!known || known === 'error') loadDay(sessionId);
  };

  const totalGames = items?.reduce((sum, item) => sum + item.gamesPlayed, 0) ?? 0;

  return (
    // 수정 시트(z-50) 위에 뜬다 — 같은 층이라도 나중에 그려진 이 시트가 위에 온다
    <Sheet
      ariaLabel={`${name} 출석 이력`}
      layer="z-50"
      onClose={onClose}
      height="h-[80dvh] sm:h-[min(640px,80dvh)]"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h3 className="min-w-0 truncate font-bold text-court">{name} 출석 이력</h3>
          {items !== null && <span className="tabular shrink-0 font-mono text-caption text-faint">{total}회</span>}
        </>
      }
    >
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-1.5 scroll-area">
        {items === null && !error && <p className="py-8 text-center text-body-sm text-dim">불러오는 중...</p>}
        {items !== null && items.length === 0 && (
          <p className="py-8 text-center text-body-sm text-faint">출석 기록이 없어요</p>
        )}
        {items?.map((item) => {
          const open = openId === item.sessionId;
          const games = dayGames.get(item.sessionId);
          return (
            <div key={item.sessionId} className="shrink-0 rounded-xl bg-panel2">
              {/* 0게임인 날은 펼칠 게 없다 */}
              <button
                onClick={() => toggleDay(item.sessionId)}
                disabled={item.gamesPlayed === 0}
                aria-expanded={open}
                className="flex min-h-11 w-full items-center px-3 text-left text-sm"
              >
                <span className="tabular font-mono">{item.date}</span>
                <span className={`tabular ml-auto font-mono text-xs ${item.gamesPlayed ? 'text-dim' : 'text-faint'}`}>
                  {item.gamesPlayed}게임
                </span>
                {item.gamesPlayed > 0 && <span className="ml-2 w-3 text-xs text-faint">{open ? '▾' : '▸'}</span>}
              </button>
              {open && games && (
                <div className="px-2 pb-2">
                  <DayGameList games={games} me={{ name, grade }} onRetry={() => loadDay(item.sessionId)} />
                </div>
              )}
            </div>
          );
        })}
        {error && (
          <button onClick={() => void load(page + 1)} className="py-4 text-center text-body-sm text-coral">
            불러오지 못했어요 — 눌러서 다시 시도
          </button>
        )}
        {hasMore && (
          <div ref={sentinelRef} className="py-4 text-center text-body-sm text-faint">
            {loading ? '더 불러오는 중...' : ''}
          </div>
        )}
        {/* 다 받았을 때만 합계 — 일부만 받은 상태의 합은 전체 게임 수와 달라 헷갈린다 */}
        {items !== null && items.length > 0 && !hasMore && !error && (
          <p className="py-3 text-center text-caption text-faint">
            전체 {total}회 · {totalGames}게임
          </p>
        )}
      </div>
    </Sheet>
  );
}
