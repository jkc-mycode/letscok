'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

// 히스토리 허브 상단 탭 — /admin/history(모임 목록)와 /admin/history/ranking(참여 랭킹)을 오간다
export function HistoryTabs({ current }: { current: 'sessions' | 'ranking' }) {
  const tabs = [
    { key: 'sessions', label: '모임', href: '/admin/history' },
    { key: 'ranking', label: '랭킹', href: '/admin/history/ranking' },
  ] as const;

  return (
    <nav className="flex gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`flex h-10 items-center rounded-lg border px-5 text-sm font-bold ${
            current === tab.key
              ? 'border-court bg-court/10 text-court'
              : 'border-line text-dim transition-colors hover:border-court/40'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

// 상세로 들어가는 링크에 붙이는 출발 화면 — 뒤로 버튼 문구와 되돌아갈 곳을 정한다
export type HistoryFrom = 'list' | 'ranking' | 'session' | 'member';

const FROM_BACK: Record<HistoryFrom, { label: string; href: string }> = {
  list: { label: '모임 목록', href: '/admin/history' },
  ranking: { label: '랭킹', href: '/admin/history/ranking' },
  session: { label: '모임 상세', href: '/admin/history' },
  member: { label: '이전 전적', href: '/admin/history' },
};

export function historyHref(path: string, from: HistoryFrom) {
  return `${path}?from=${from}`;
}

// 상세 화면의 뒤로 — 기록 안에서 들어왔으면 브라우저 뒤로와 같게 바로 전 화면으로(목록 쪽수·랭킹 기간·정렬은 그 화면 주소에 남아 있다)
// 주소로 바로 열어 전 화면이 없으면 링크로 간다
export function HistoryBackLink() {
  const router = useRouter();
  const raw = useSearchParams().get('from');
  const from = raw && raw in FROM_BACK ? (raw as HistoryFrom) : null;
  const back = from ? FROM_BACK[from] : FROM_BACK.list;

  return (
    <Link
      href={back.href}
      onClick={(e) => {
        if (!from || window.history.length <= 1) return;
        e.preventDefault();
        router.back();
      }}
      className="text-sm text-dim transition-opacity hover:opacity-70"
    >
      ← {back.label}
    </Link>
  );
}
