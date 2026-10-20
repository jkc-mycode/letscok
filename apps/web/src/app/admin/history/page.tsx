'use client';

import { IHistorySessionListResponse, IHistorySessionSummary } from '@letscok/shared-types';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AdminGate } from '@/components/admin-gate';
import { HistoryTabs, historyHref } from '@/components/history-tabs';
import { InstallPrompt } from '@/components/install-prompt';
import { api, ApiError } from '@/lib/api';
import { sessionTag } from '@/lib/session-report';

const PAGE_SIZE = 50; // 서버 상한과 같다 — 한 줄이 가벼워 요청 수를 줄이는 쪽이 빠르다

export default function HistoryPage() {
  return (
    <AdminGate title="지난 모임 기록">
      <HistoryList />
    </AdminGate>
  );
}

const RESTORE_KEY = 'letscok.historyListRestore'; // 상세로 들어갈 때 불러온 쪽수·스크롤 위치 — 뒤로 오면 그대로 복원

function HistoryList() {
  const [sessions, setSessions] = useState<IHistorySessionSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 지금까지 받은 쪽 수
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = (n: number) =>
    api<IHistorySessionListResponse>(`/history/sessions?page=${n}&limit=${PAGE_SIZE}`, { admin: true });

  const load = async (next: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPage(next);
      setSessions((prev) => (next === 1 ? data.sessions : [...(prev ?? []), ...data.sessions]));
      setTotal(data.total);
      setPage(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 첫 진입은 1쪽만. 상세에서 돌아왔으면 보던 쪽까지 한꺼번에 받고 스크롤 위치로
  useEffect(() => {
    let saved: { pages: number; scrollY: number } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESTORE_KEY) ?? 'null');
      sessionStorage.removeItem(RESTORE_KEY);
    } catch {}
    if (!saved || saved.pages <= 1) {
      void load(1).then(() => saved && requestAnimationFrame(() => window.scrollTo(0, saved.scrollY)));
      return;
    }
    const pages = saved.pages;
    const scrollY = saved.scrollY;
    setLoading(true);
    Promise.all(Array.from({ length: pages }, (_, i) => fetchPage(i + 1)))
      .then((results) => {
        setSessions(results.flatMap((r) => r.sessions));
        setTotal(results[results.length - 1].total);
        setPage(pages);
        requestAnimationFrame(() => window.scrollTo(0, scrollY));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '기록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const rememberPosition = () => {
    try {
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ pages: page, scrollY: window.scrollY }));
    } catch {}
  };

  const hasMore = sessions !== null && sessions.length < total && !error;
  const loadMoreRef = useRef(() => {});
  loadMoreRef.current = () => {
    if (hasMore && !loading) void load(page + 1);
  };
  // 불러온 뒤에도 끝 표시가 아직 보이면(목록이 짧은 화면) 바로 한 번 더 — 다시 관찰을 걸면 즉시 알려 준다
  const loadedCount = sessions?.length ?? 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMoreRef.current(), {
      rootMargin: '300px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadedCount]);

  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 p-6">
      <InstallPrompt app="admin" />
      <header>
        {/* 설치된 관제판 앱에는 브라우저 뒤로가기가 없다 — 홈 로고도 scope 밖이라 링크가 아니어서
            이 링크가 없으면 관제판으로 돌아갈 방법이 사라진다 */}
        <Link href="/admin" className="text-sm text-dim transition-opacity hover:opacity-70">
          ← 운영 화면
        </Link>
        <h1 className="mt-1 text-2xl font-bold">지난 모임 기록</h1>
        {sessions && <p className="mt-1 text-sm text-dim">총 {total}번의 모임</p>}
      </header>

      <HistoryTabs current="sessions" />

      {error && sessions === null && <p className="py-10 text-center text-sm text-coral">{error}</p>}
      {!error && sessions === null && <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>}
      {sessions?.length === 0 && (
        <p className="py-10 text-center text-sm text-faint">아직 종료된 모임이 없어요</p>
      )}

      <div className="flex flex-col gap-2">
        {sessions?.map((session) => (
          <Link
            key={session.id}
            href={historyHref(`/admin/history/${session.id}`, 'list')}
            onClick={rememberPosition}
            className="flex items-center gap-3 rounded-xl bg-panel p-4 transition-colors hover:bg-panel2"
          >
            <span className="font-bold">
              {session.date}
              {sessionTag(session) && <span className="ml-1.5 text-sm text-sky">{sessionTag(session)}</span>}
            </span>
            <span className="ml-auto text-sm text-dim">
              출석 {session.attendeeCount}명 · 게임 {session.finishedGameCount}판
            </span>
          </Link>
        ))}
      </div>

      {error && sessions !== null && (
        <button onClick={() => void load(page + 1)} className="py-4 text-center text-sm text-coral">
          불러오지 못했어요 — 눌러서 다시 시도
        </button>
      )}
      {hasMore && (
        <div ref={sentinelRef} className="py-4 text-center text-sm text-faint">
          {loading ? '더 불러오는 중...' : ''}
        </div>
      )}
    </main>
  );
}
