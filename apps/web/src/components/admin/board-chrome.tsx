'use client';

import { IOpenSessionBrief } from '@letscok/shared-types';
import { useRef, type RefObject, type TouchEvent as ReactTouchEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { HomeLink } from '@/components/home-link';
import { SessionSwitcher } from '@/components/session-switcher';
import { Sheet } from '@/components/sheet';
import { ThemeToggle } from '@/components/theme-toggle';

// 관제판 보드의 테두리 — 머리·모임 칩, 더보기 시트, 폰 구역 탭과 좌우 스와이프 (보드 내용·즉시 반영과 무관)

// ===== 머리 =====

// 태블릿은 자주 쓰는 두 개(체크인 코드·게임 기록)만 펼치고 나머지는 폰과 같은 더보기 시트로
export function BoardHeader({
  date,
  presentCount,
  openSessions,
  sessionId,
  onSelectSession,
  onOpenCode,
  onOpenLog,
  onOpenMenu,
}: {
  date: string;
  presentCount: number;
  openSessions: IOpenSessionBrief[];
  sessionId: string;
  onSelectSession: (id: string) => Promise<void>;
  onOpenCode: () => void;
  onOpenLog: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <>
      <header className="flex items-center gap-2 pb-2 md:gap-3 md:pb-3">
        <HomeLink className="shrink-0 transition-opacity hover:opacity-70" title="홈으로">
          <h1 className="text-body font-bold md:text-heading">
            렛츠콕 <span className="text-court">운영</span>
          </h1>
        </HomeLink>
        <p className="truncate text-caption text-dim md:text-body-sm">
          {date} · 출석 {presentCount}명
        </p>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <button onClick={onOpenCode} className="h-11 rounded-xl bg-court/15 px-4 text-body-sm font-bold text-court">
            입장 코드
          </button>
          <button onClick={onOpenLog} className="h-11 rounded-xl bg-panel px-4 text-body-sm font-medium text-dim">
            게임 기록
          </button>
        </div>
        <button
          onClick={onOpenMenu}
          aria-label="더보기"
          className="tap ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-panel text-dim md:ml-0 md:h-11 md:w-11"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>
      {/* 여복·남복처럼 동시에 연 모임 — 둘 이상일 때만 보인다 */}
      <SessionSwitcher sessions={openSessions} currentId={sessionId} onSelect={onSelectSession} className="pb-2 md:pb-3" />
    </>
  );
}

// ===== 더보기 =====

// 더보기 시트의 항목 — 폰·태블릿 공용
export type MoreAction = {
  key: string;
  label: string;
  keepMenuOpen?: boolean; // 2탭 확인·토글이라 메뉴를 닫으면 안 되는 것
  onClick: () => void;
};

// 묶음 — 자주 쓰는 것 위, 관리 기능 아래(잠금·모임 종료는 시트 맨 아래 따로)
const MORE_GROUPS: { title: string; keys: string[] }[] = [
  { title: '모임 중', keys: ['code', 'log', 'entryFee', 'courts', 'display', 'another'] },
  { title: '관리', keys: ['members', 'history', 'birthday', 'settlement', 'help'] },
];

// 햄버거가 보드를 밀어내던 격자 대신 아래에서 올라오는 목록. 위험한 항목은 맨 아래 따로
export function MoreMenuSheet({
  actions,
  closeLabel,
  onCloseSession,
  onLogout,
  onClose,
}: {
  actions: MoreAction[];
  closeLabel: string; // 동시 진행 중엔 "'남복' 모임 종료"
  onCloseSession: () => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      ariaLabel="더보기"
      onClose={onClose}
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap">더보기</h2>}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4 pb-1 scroll-area"
    >
      {MORE_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <p className="px-1 text-caption font-bold text-dim">{group.title}</p>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-panel2">
            {group.keys.map((key) => {
              const action = actions.find((a) => a.key === key);
              if (!action) return null;
              return (
                <button
                  key={key}
                  onClick={() => {
                    action.onClick();
                    if (!action.keepMenuOpen) onClose();
                  }}
                  className="flex h-13 items-center border-b border-line/60 px-4 text-left text-body font-medium last:border-b-0"
                >
                  {action.label}
                  <span className="ml-auto text-faint">›</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <p className="px-1 text-caption font-bold text-dim">화면</p>
        <ThemeToggle />
      </div>
      {/* shrink-0 — overflow-hidden 상자는 세로 목록에서 내용보다 작게 줄어든다. 낮은 폰에서 목록이 넘치면
          스크롤 대신 이 상자가 눌려 [잠금]·[모임 종료]가 납작해지던 문제(위 묶음들은 바깥 div가 있어 안 줄어듦) */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl bg-panel2">
        <button onClick={onLogout} className="flex h-13 items-center border-b border-line/60 px-4 text-left text-body text-dim">
          잠금 — 저장된 패스코드 지우기
        </button>
        {/* 2탭 확인 — 첫 탭은 문구만 바뀌고 시트는 그대로 */}
        <ConfirmButton
          label={closeLabel}
          confirmLabel="한 번 더 누르면 모임이 종료돼요"
          onConfirm={onCloseSession}
          className="flex h-13 items-center px-4 text-left text-body font-bold"
          idleCls="text-coral"
          armedCls="bg-coral/15 text-coral"
        />
      </div>
    </Sheet>
  );
}

// ===== 폰 구역 탭 =====

// 화면 맨 아래(엄지 자리). md 이상은 구역이 동시에 보여 숨는다. 선택 표시(.board-tab-indicator)가 스와이프를 따라 미끄러진다
export function MobileTabBar<T extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  current: T;
  onChange: (tab: T) => void;
}) {
  return (
    <nav aria-label="구역" className="relative mt-2 flex shrink-0 rounded-2xl bg-panel p-1 md:hidden">
      <span
        aria-hidden
        className="board-tab-indicator absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-xl bg-court/15"
      />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          aria-current={current === tab.value ? 'page' : undefined}
          className={`relative flex h-12 flex-1 items-center justify-center gap-1 rounded-xl text-sm font-bold transition-colors ${
            current === tab.value ? 'text-court' : 'text-dim'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span
              className={`tabular min-w-5 rounded-full px-1.5 font-mono text-caption leading-5 ${
                current === tab.value ? 'bg-court text-bg' : 'bg-line text-ink'
              }`}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

const SWIPE_LOCK_PX = 8; // 이만큼 움직인 뒤 가로·세로 중 큰 쪽으로 방향을 정한다
const SWIPE_COMMIT_PX = 70; // 손을 뗐을 때 이 이상(또는 화면 폭 25% 이상) 밀었으면 옆 탭으로
const SWIPE_EDGE_GUARD = 20; // 화면 가장자리 시작 스와이프는 시스템 제스처에 양보

// 폰에서 구역 간 가로 스와이프 이동 — 미는 동안 React 렌더 없이 CSS 변수(--drag)만 바꿔 화면과 탭 표시가 손가락을 따라오고,
// 놓으면 옆 탭으로 넘어간다(md 이상은 구역이 동시에 보이므로 무시). 돌려준 핸들러를 구역 트랙에 단다
export function useTabSwipe({
  boardRef,
  tabIndex,
  tabCount,
  dragging,
  onSwipe,
}: {
  boardRef: RefObject<HTMLElement | null>; // --drag·data-dragging을 다는 보드 바깥 틀
  tabIndex: number;
  tabCount: number;
  dragging: RefObject<boolean>; // 조합 카드를 끄는 중 — 끌다가 옆 구역으로 넘어가지 않게
  onSwipe: (step: 1 | -1) => void;
}) {
  const swipe = useRef<{ x: number; y: number; dir: 'h' | 'v' | null; dx: number } | null>(null);
  const setDrag = (dx: number) => {
    const el = boardRef.current;
    if (!el) return;
    el.style.setProperty('--drag', `${dx}px`);
    el.style.setProperty('--drag-ratio', String(dx / el.clientWidth));
  };

  const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    // 화면 가장자리에서 시작한 스와이프는 시스템 뒤로가기 몫이라 건드리지 않는다
    if (
      window.innerWidth >= 768 ||
      touch.clientX < SWIPE_EDGE_GUARD ||
      touch.clientX > window.innerWidth - SWIPE_EDGE_GUARD
    ) {
      swipe.current = null;
      return;
    }
    swipe.current = { x: touch.clientX, y: touch.clientY, dir: null, dx: 0 };
  };

  const onTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s) return;
    // 조합 카드를 끄는 중이면 구역 넘기기는 포기(끌다가 옆 구역으로 넘어가지 않게)
    if (dragging.current) {
      swipe.current = null;
      if (s.dir === 'h') {
        boardRef.current?.removeAttribute('data-dragging');
        setDrag(0);
      }
      return;
    }
    const touch = e.touches[0];
    const dx = touch.clientX - s.x;
    const dy = touch.clientY - s.y;
    if (!s.dir) {
      if (Math.abs(dx) < SWIPE_LOCK_PX && Math.abs(dy) < SWIPE_LOCK_PX) return;
      s.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'; // 세로로 시작했으면 끝까지 스크롤로 둔다
      if (s.dir === 'h') boardRef.current?.setAttribute('data-dragging', '');
    }
    if (s.dir !== 'h') return;
    // 첫 탭에서 오른쪽, 마지막 탭에서 왼쪽으로는 고무줄처럼 조금만 끌려온다
    const atEnd = (dx > 0 && tabIndex === 0) || (dx < 0 && tabIndex === tabCount - 1);
    s.dx = atEnd ? dx * 0.3 : dx;
    setDrag(s.dx);
  };

  const onTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.dir !== 'h') return;
    boardRef.current?.removeAttribute('data-dragging'); // 전환 애니메이션 다시 켜기 → 놓은 자리에서 제자리/옆 탭으로 미끄러진다
    const width = boardRef.current?.clientWidth ?? window.innerWidth;
    const committed = Math.abs(s.dx) >= Math.min(SWIPE_COMMIT_PX, width * 0.25);
    setDrag(0);
    // 양 끝에서는 옆 탭이 없어 제자리로 돌아간다
    const next = tabIndex + (s.dx < 0 ? 1 : -1);
    if (committed && next >= 0 && next < tabCount) onSwipe(s.dx < 0 ? 1 : -1);
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
}
