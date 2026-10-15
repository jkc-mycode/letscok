'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BirthdayCalendarModal } from '@/components/birthday-calendar';
import { SettlementModal } from '@/components/settlement-modal';
import { ThemeToggle } from '@/components/theme-toggle';
import { Toast } from '@/components/badges';
import { HomeLink } from '@/components/home-link';
import { InstallPrompt } from '@/components/install-prompt';
import { api } from '@/lib/api';
import { ToastState } from '@/lib/use-toast';
import { MembersManagerModal } from '@/components/admin/members-manager';

// 모임 시작 전 화면 — [오늘 모임 시작]과 모임 밖 메뉴(모임원 관리·지난 기록·생일·정산)

export function StartScreen({
  run,
  busy,
  toast,
  onLogout,
}: {
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
  toast: ToastState | null;
  onLogout: () => void;
}) {
  // 명단 정리는 모임 전이 한가하다 — 세션 없이도 모임원 관리에 들어갈 수 있게
  const [membersOpen, setMembersOpen] = useState(false);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false); // 뒤풀이는 모임이 끝난(종료한) 뒤에 정산하는 경우가 많다
  return (
    // 디자인 시스템: 큰 제목 + 주요 버튼 하나(모임 시작), 모임 전에 하기 좋은 일은 한 덩어리 목록
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-2 pb-6">
      <InstallPrompt app="admin" />
      <HomeLink className="flex h-11 items-center self-start text-caption font-bold tracking-[0.3em] text-court transition-opacity hover:opacity-70">
        LETSCOK
      </HomeLink>
      <header className="flex flex-col gap-1.5">
        <p className="text-body-sm text-dim">{todayLabel()}</p>
        <h1 className="text-display font-bold">아직 모임 전이에요</h1>
        <p className="text-body text-dim">모임을 시작하면 출석을 받을 수 있어요</p>
      </header>
      <button
        onClick={() => void run(() => api('/sessions', { method: 'POST', admin: true }))}
        disabled={busy}
        className="h-16 rounded-2xl bg-court text-heading font-bold text-bg disabled:opacity-50"
      >
        오늘 모임 시작
      </button>
      {/* 모임 전이 한가하니 명단 정리·기록 열람을 여기서 바로 들어가게 둔다
          (지난 기록은 원래 홈에만 링크가 있었는데, 홈은 관제판 앱 scope 밖이라 설치본에선 못 간다) */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-body-sm font-bold text-dim">모임 전에 하기 좋은 일</h2>
        <div className="flex flex-col rounded-2xl bg-panel py-1">
          <MenuRow icon={<IconUsers />} label="모임원 관리" onClick={() => setMembersOpen(true)} />
          <MenuRow icon={<IconChart />} label="지난 기록" href="/admin/history" />
          <MenuRow icon={<IconCalendar />} label="생일" onClick={() => setBirthdayOpen(true)} />
          <MenuRow icon={<IconCard />} label="뒤풀이 정산" onClick={() => setSettlementOpen(true)} />
        </div>
      </section>
      <div className="mt-auto flex flex-col gap-3">
        <ThemeToggle />
        {/* 잠금 — 보드의 [잠금]과 같다. 저장된 패스코드를 지우고 입력 화면으로 (모임 전엔 보드가 없어 여기 둔다) */}
        <button
          onClick={onLogout}
          title="이 기기에 저장된 운영진 패스코드를 지우고 입력 화면으로 돌아가요"
          className="h-11 text-body-sm text-dim hover:text-coral"
        >
          잠금 — 저장된 패스코드 지우기
        </button>
      </div>
      {membersOpen && <MembersManagerModal onClose={() => setMembersOpen(false)} />}
      {birthdayOpen && <BirthdayCalendarModal onClose={() => setBirthdayOpen(false)} />}
      {settlementOpen && <SettlementModal onClose={() => setSettlementOpen(false)} />}
      {toast && <Toast toast={toast} />}
    </main>
  );
}

// "10월 7일 화요일" — 모임 시작 전 화면 머리
function todayLabel(): string {
  return new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
}

// 목록 한 줄(아이콘 칸 + 이름 + ›) — 버튼이거나 화면 이동 링크
function MenuRow({
  icon,
  label,
  onClick,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-panel2 text-court">{icon}</span>
      <span className="text-body font-medium">{label}</span>
      <span className="ml-auto text-faint">›</span>
    </>
  );
  const cls = 'flex h-14 items-center gap-3 px-4 text-left';
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

// 선 아이콘(18px, 글자색) — 이모지 대신
function LineIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const IconUsers = () => (
  <LineIcon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </LineIcon>
);

const IconChart = () => (
  <LineIcon>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-6" />
  </LineIcon>
);

const IconCalendar = () => (
  <LineIcon>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </LineIcon>
);

const IconCard = () => (
  <LineIcon>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </LineIcon>
);
