'use client';

import Link from 'next/link';

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
