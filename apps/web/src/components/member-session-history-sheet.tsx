'use client';

import type { IHistoryMemberSessionPage } from '@letscok/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api } from '@/lib/api';

const PAGE_SIZE = 50;

type Item = IHistoryMemberSessionPage['items'][number];

// 한 사람의 전체 출석 이력 — 최신순 50개씩, 목록 끝이 보이면 다음 쪽(모임원 관리 목록과 같은 무한 스크롤)
export function MemberSessionHistorySheet({
  memberId,
  name,
  onClose,
}: {
  memberId: string;
  name: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null); // null=첫 로딩
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 지금까지 받은 쪽 수
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
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
        {items?.map((item) => (
          <div key={item.sessionId} className="flex items-center rounded-xl bg-panel2 px-3 py-2.5 text-sm">
            <span className="tabular font-mono">{item.date}</span>
            <span className={`tabular ml-auto font-mono text-xs ${item.gamesPlayed ? 'text-dim' : 'text-faint'}`}>
              {item.gamesPlayed}게임
            </span>
          </div>
        ))}
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
