'use client';

import {
  GAME_SIZE,
  IAttendance,
  ICourt,
  IFillCourtsResult,
  IGame,
  IPushCallResult,
  ISessionSnapshot,
  MemberRole,
} from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { LoginGate, useAdminAuth } from '@/components/admin-gate';
import { BirthdayCalendarModal } from '@/components/birthday-calendar';
import {
  BoardDnd,
  mergeRefs,
  useBoardDragEnabled,
  useDropTarget,
  useGameDrag,
  usePersonDrag,
  type DragItem,
  type DropTarget,
  type GameRef,
} from '@/components/board-dnd';
import { arrayMove } from '@dnd-kit/sortable';
import { CommandSheet } from '@/components/command-sheet';
import { ConnectionError } from '@/components/connection-error';
import { SessionReportModal } from '@/components/session-report-modal';
import { EntryFeeSheet } from '@/components/entry-fee-sheet';
import { SettlementModal } from '@/components/settlement-modal';
import { Sheet } from '@/components/sheet';
import { ThemeToggle } from '@/components/theme-toggle';
import { ExitGuard } from '@/components/exit-guard';
import { gamePartnerPeople, GenderMarker, GradeBadge, PartnerNote, Toast } from '@/components/badges';
import { HomeLink } from '@/components/home-link';
import { InstallPrompt } from '@/components/install-prompt';
import { CrownIcon, MegaphoneIcon } from '@/components/icons';
import { LogoLoader } from '@/components/logo-loader';
import { MotionCard } from '@/components/motion-card';
import { GRADES } from '@/components/multi-member-form';
import { api, ApiError } from '@/lib/api';
import { formatElapsed, formatWaitingMinutes, useNow, useSnapshot } from '@/lib/use-snapshot';
import { ToastState, useToast } from '@/lib/use-toast';
import { MembersManagerModal } from '@/components/admin/members-manager';
import { ManualCheckInModal } from '@/components/admin/manual-check-in';
import { RecommendModal } from '@/components/admin/recommend-sheet';
import { CourtPickSheet, CourtsManager } from '@/components/admin/courts-manager';
import { TodayGamesModal } from '@/components/admin/today-games';
import { HelpModal } from '@/components/admin/help-sheet';
import { CheckInCodeModal } from '@/components/admin/check-in-code';
import { MemoPanel } from '@/components/admin/memo-panel';
import { CheerEasterEgg } from '@/components/admin/cheer';

// ===== 페이지 루트: 패스코드 게이트 → 보드 =====

export default function AdminPage() {
  const { authed, notice, login, logout } = useAdminAuth();

  if (authed === null) return null;
  return authed ? (
    <>
      <Board onLogout={logout} />
      <ExitGuard />
    </>
  ) : (
    <LoginGate title="렛츠콕 운영" notice={notice} onSuccess={login} />
  );
}

// ===== 보드 =====

function Board({ onLogout }: { onLogout: () => void }) {
  const { snapshot, noSession, failed, loading, refetch } = useSnapshot();
  const { toast, showToast, hideToast } = useToast();
  const [inFlight, setInFlight] = useState(0); // 진행 중인 요청 수 — 팝업 버튼은 이게 0일 때만 켠다
  const busy = inFlight > 0;
  const lockedKeys = useRef(new Set<string>()); // 같은 대상(게임·조합 순서 등)을 연달아 누른 것만 막는다
  // 방금 종료한 모임의 마무리 문구 — 종료하면 보드(BoardBody)가 사라지므로 상태는 여기서 들고 있다.
  // 문구 팝업을 닫아야 패스코드를 지우고 로그인 화면으로 간다(종료 = 그날 운영 끝)
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  const report = reportSessionId && (
    <SessionReportModal
      sessionId={reportSessionId}
      onClose={() => {
        setReportSessionId(null);
        onLogout();
      }}
    />
  );

  // 성공 뒤 새로고침은 마지막 요청 뒤 한 번만 — 실시간 화면이 보통 먼저 오고, 이건 소켓 룸 입장 전·연결 끊김 대비.
  // 요청마다 하면 [모두 콕 확인]으로 20명이면 요청이 40개가 되어 분당 요청 제한에 가까워진다
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);
  const scheduleRefetch = () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void refetch(), 400);
  };

  // 모든 변경 액션의 공통 실행기 — 실패 시 서버의 한국어 메시지를 토스트로
  // 화면 새로고침은 기다리지 않는다(서버를 두 번 오가는 동안 멈춘 것처럼 보였다). 전체 잠금도 없다 — 앞 동작이 끝나기 전
  // 누른 다른 동작이 조용히 무시됐다. lockKey를 주면 같은 대상의 연타만 막는다(게임 종료 두 번 → 두 번째가 오류 토스트).
  // 그 잠금은 새 화면을 받은 뒤 푼다 — 조합 순서(▲▼)처럼 화면 값을 보내는 동작이 옛 값으로 다시 나가지 않게
  const run = async (action: () => Promise<unknown>, lockKey?: string) => {
    if (lockKey) {
      if (lockedKeys.current.has(lockKey)) return;
      lockedKeys.current.add(lockKey);
    }
    setInFlight((n) => n + 1);
    let ok = false;
    const beforeBoard = noSession || !snapshot;
    try {
      await action();
      ok = true;
      // 모임 전 화면은 새로고침이 와야 보드로 넘어간다 — 그동안 [오늘 모임 시작]이 다시 켜지지 않게 여기서 기다린다
      if (beforeBoard) await refetch();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setInFlight((n) => n - 1);
    }
    try {
      if (lockKey) await refetch();
      else if (ok && !beforeBoard) scheduleRefetch();
    } finally {
      if (lockKey) lockedKeys.current.delete(lockKey);
    }
  };
  // 사람마다 따로인 빠른 동작(콕 확인·낙관적 반영)용 — 성공 여부를 돌려줘 실패하면 화면을 되돌릴 수 있게
  const runParallel = async (action: () => Promise<unknown>) => {
    try {
      await action();
      scheduleRefetch(); // 화면은 이미 바뀌어 있고 실시간 화면도 곧 온다
      return true;
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
      return false;
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <LogoLoader />
      </main>
    );
  }
  // 서버에 닿지 못했는데 "모임 전"으로 보이면 [오늘 모임 시작]을 누르게 된다 — 오류 화면을 따로 둔다
  if (failed && !snapshot) {
    return (
      <main className="flex min-h-dvh flex-col">
        <ConnectionError onRetry={refetch} />
      </main>
    );
  }
  if (noSession || !snapshot) {
    return (
      <>
        <StartScreen run={run} busy={busy} toast={toast} onLogout={onLogout} />
        {report}
      </>
    );
  }
  return (
    <>
      <BoardBody
        snapshot={snapshot}
        run={run}
        runParallel={runParallel}
        busy={busy}
        toast={toast}
        showToast={showToast}
        hideToast={hideToast}
        onLogout={onLogout}
        onSessionClosed={setReportSessionId}
      />
      {report}
    </>
  );
}

function StartScreen({
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

// 폰 더보기 시트의 묶음 — 자주 쓰는 것 위, 관리 기능 아래(잠금·모임 종료는 시트 맨 아래 따로)
const MORE_GROUPS: { title: string; keys: string[] }[] = [
  { title: '모임 중', keys: ['code', 'log', 'entryFee', 'courts', 'display'] },
  { title: '관리', keys: ['members', 'history', 'birthday', 'settlement', 'help'] },
];

// 폰 전용 구역 탭 — md 이상에서는 전부 동시에 보이므로 무시된다
type MobileTab = 'courts' | 'queue' | 'waiting' | 'memo';

const SWIPE_LOCK_PX = 8; // 이만큼 움직인 뒤 가로·세로 중 큰 쪽으로 방향을 정한다
const SWIPE_COMMIT_PX = 70; // 손을 뗐을 때 이 이상(또는 화면 폭 25% 이상) 밀었으면 옆 탭으로
const SWIPE_EDGE_GUARD = 20; // 화면 가장자리 시작 스와이프는 시스템 제스처에 양보

// 누르자마자 보여 주는 새 조합 — 서버 id가 오기 전 임시 id. realId = 빈칸 조합을 한 명씩 채우는 중인 서버 조합
const TEMP_GAME_PREFIX = 'temp:';
type GamePlayer = NonNullable<IGame['players']>[number];
// 조합 카드 안 조작(자리 바꾸기·빼기) — 누르자마자 반영하는 BoardBody의 함수를 카드 칸까지 내려 준다
interface SlotActions {
  moveSlot: (gameId: string, attendanceId: string, slot: number) => void;
  removePlayer: (gameId: string, attendanceId: string) => void;
}
const playersSignature = (players: GamePlayer[] = []) =>
  players.map((p) => `${p.attendanceId}:${p.slot}`).sort().join(',');
type OptimisticGame = { game: IGame; ids: string[]; realId?: string };

// 서버 화면에 같은 조합이 실렸는지 — 같은 4명 조합은 서버가 중복으로 막아서 사람 묶음으로 알아볼 수 있다
function isSettled(t: OptimisticGame, games: IGame[]): boolean {
  return games.some((g) => {
    const ids = (g.players ?? []).map((p) => p.attendanceId);
    if (g.id === t.realId) return ids.length >= t.ids.length;
    return g.status === 'QUEUED' && ids.length === t.ids.length && t.ids.every((id) => ids.includes(id));
  });
}

function BoardBody({
  snapshot,
  run,
  runParallel,
  busy,
  toast,
  showToast,
  hideToast,
  onLogout,
  onSessionClosed,
}: {
  snapshot: ISessionSnapshot;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  runParallel: (a: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
  toast: ToastState | null;
  showToast: ReturnType<typeof useToast>['showToast'];
  hideToast: () => void;
  onLogout: () => void;
  onSessionClosed: (sessionId: string) => void; // 모임 종료 성공 → 마무리 문구 띄우기
}) {
  const router = useRouter();
  const now = useNow();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [recommendFillId, setRecommendFillId] = useState<string | null>(null); // 짜는 중 조합의 빈자리 추천
  const [codeOpen, setCodeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false); // 운영진 수동 체크인 (사전 등록·현장 대리 등 예외용)
  const [membersOpen, setMembersOpen] = useState(false); // 모임원 관리 (명단 조회·수정·정리)
  const [birthdayOpen, setBirthdayOpen] = useState(false); // 생일 캘린더
  const [settlementOpen, setSettlementOpen] = useState(false); // 뒤풀이 정산
  const [entryFeeOpen, setEntryFeeOpen] = useState(false); // 오늘의 입장비(계좌·받았는지 체크)

  // 이스터에그 — 대기 인원 헤더의 [수동 체크인] 왼쪽 빈 영역 13연타 (현장 태블릿용 서프라이즈)
  // 연타 카운트는 리렌더와 무관한 ref로, 1초 이상 쉬면 리셋(누적 탭 우연 발동 방지)
  const cheerTapCount = useRef(0);
  const cheerLastTapAt = useRef(0);
  const [cheer, setCheer] = useState(false);
  const closeCheer = useCallback(() => setCheer(false), []);
  const handleCheerTap = () => {
    const at = Date.now();
    if (at - cheerLastTapAt.current > CHEER_TAP_GAP_MS) cheerTapCount.current = 0;
    cheerLastTapAt.current = at;
    cheerTapCount.current += 1;
    if (cheerTapCount.current >= CHEER_TAPS) {
      cheerTapCount.current = 0;
      setCheer(true);
    }
  };
  const [gamesLogOpen, setGamesLogOpen] = useState(false); // 오늘 완료 게임 조회·이름 검색
  // 폰(<md)에서는 3구역을 한 번에 못 보여주므로 탭 전환 — 조작 시작점인 대기 인원이 기본
  const [mobileTab, setMobileTab] = useState<MobileTab>('waiting');
  // 탭 스와이프 — 미는 동안은 React 렌더 없이 CSS 변수(--drag)만 바꿔 화면이 손가락을 따라오게 한다
  const boardRef = useRef<HTMLElement>(null);
  const swipe = useRef<{ x: number; y: number; dir: 'h' | 'v' | null; dx: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); // 폰 헤더 햄버거
  const [replaceGameId, setReplaceGameId] = useState<string | null>(null); // 선수 교체 대상 게임
  const [assignGameId, setAssignGameId] = useState<string | null>(null); // 코트 고르기 시트 대상 조합
  const [actionId, setActionId] = useState<string | null>(null); // 폰 대기 줄 [⋯] 시트 대상 출석
  const [cardMenuId, setCardMenuId] = useState<string | null>(null); // 코트·조합 카드 [⋯] 시트 대상 게임
  const [moveGameId, setMoveGameId] = useState<string | null>(null); // 다른 코트로 옮길 게임 중 조합
  const [commandOpen, setCommandOpen] = useState(false); // AI 명령(글·음성)
  // 빈칸 채우기 시트 — gameId=null이면 새 조합(첫 사람을 고르면 그 조합으로 이어서 채운다)
  // pending = 방금 만든 조합(실시간 화면이 도착하기 전까지 대신 보여 줘서 시트가 깜빡 닫히지 않게)
  const [slotTarget, setSlotTarget] = useState<{ gameId: string | null; pending?: IGame } | null>(null);

  const { session } = snapshot;
  const dragEnabled = useBoardDragEnabled(); // 태블릿 이상 — 자석판처럼 끌어다 놓기

  // 코트 배정·조합 만들기는 누르자마자 보여 준다 — 서버 응답과 화면 새로고침(두 번 오감)을 기다리면 멈춘 것처럼 보였다.
  // 서버 화면에 실리면 이 표시는 지우고, 실패하면 되돌린다(알림은 runParallel)
  const [optAssign, setOptAssign] = useState<Map<string, { courtId: string; startedAt: string }>>(new Map());
  const [optCreated, setOptCreated] = useState<OptimisticGame[]>([]);
  // 조합 안 사람 빼기·자리 바꾸기 — 바뀐 사람 목록을 대신 보여 준다. base=처음 누를 때 서버 목록, pending=아직 안 끝난 요청 수
  // 요청이 다 끝났고 서버 목록이 base와 달라지면(반영됨) 지운다 — 연달아 누르는 중엔 지우지 않아 앞 단계로 깜빡이지 않게
  const [optPlayers, setOptPlayers] = useState<Map<string, { players: GamePlayer[]; base: string; pending: number }>>(
    new Map(),
  );
  useEffect(() => {
    setOptPlayers((prev) => {
      const next = new Map(
        [...prev].filter(([id, patch]) => {
          if (patch.pending > 0) return true;
          const server = snapshot.games.find((g) => g.id === id);
          return !!server && (server.status === 'QUEUED' || server.status === 'PLAYING') && playersSignature(server.players) === patch.base;
        }),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [snapshot.games]);
  // 게임 종료·대기로도 누르자마자 — 서버 화면에서 그 게임이 더는 '게임 중'이 아니면 지운다
  const [optEnded, setOptEnded] = useState<Map<string, { kind: 'FINISHED' | 'UNASSIGNED'; at: string }>>(new Map());
  useEffect(() => {
    setOptEnded((prev) => {
      const next = new Map([...prev].filter(([id]) => snapshot.games.find((g) => g.id === id)?.status === 'PLAYING'));
      return next.size === prev.size ? prev : next;
    });
  }, [snapshot.games]);
  useEffect(() => {
    setOptAssign((prev) => {
      const next = new Map([...prev].filter(([id]) => snapshot.games.find((g) => g.id === id)?.status === 'QUEUED'));
      return next.size === prev.size ? prev : next;
    });
    setOptCreated((prev) => {
      const next = prev.filter((t) => !isSettled(t, snapshot.games));
      return next.length === prev.length ? prev : next;
    });
  }, [snapshot.games]);
  const games = useMemo(() => {
    if (optAssign.size === 0 && optCreated.length === 0 && optEnded.size === 0 && optPlayers.size === 0) return snapshot.games;
    const pending = optCreated.filter((t) => !isSettled(t, snapshot.games));
    // 대기로 돌린 조합은 서버처럼 대기 조합 맨 뒤
    let lastOrder = Math.max(0, ...snapshot.games.map((g) => (g.status === 'QUEUED' ? (g.queueOrder ?? 0) : 0)));
    const base = snapshot.games
      // 빈칸 조합을 한 명씩 채우는 중엔 서버 쪽 반쪽 조합 대신 고른 사람 전부를 보여 준다
      .filter((g) => !pending.some((t) => t.realId === g.id))
      .map((g) => {
        const patch = optPlayers.get(g.id);
        if (patch && (g.status === 'QUEUED' || g.status === 'PLAYING')) {
          // 마지막 한 명까지 빼면 서버처럼 조합 해체
          g = patch.players.length === 0 ? { ...g, status: 'CANCELED' as const, queueOrder: null, players: [] } : { ...g, players: patch.players };
        }
        const ended = g.status === 'PLAYING' ? optEnded.get(g.id) : undefined;
        if (ended?.kind === 'FINISHED') return { ...g, status: 'FINISHED' as const, endedAt: ended.at };
        if (ended) return { ...g, status: 'QUEUED' as const, courtId: null, startedAt: null, queueOrder: ++lastOrder };
        const assigned = g.status === 'QUEUED' ? optAssign.get(g.id) : undefined;
        return assigned ? { ...g, status: 'PLAYING' as const, courtId: assigned.courtId, startedAt: assigned.startedAt } : g;
      });
    // 대기 조합 목록은 배열 순서대로 그려진다 — 대기로 돌린 조합을 배열에서도 맨 뒤로
    const back = base.filter((g) => g.status === 'QUEUED' && optEnded.get(g.id)?.kind === 'UNASSIGNED');
    const rest = back.length ? base.filter((g) => !back.includes(g)) : base;
    return [...rest, ...back, ...pending.map((t) => t.game)];
  }, [snapshot.games, optAssign, optCreated, optEnded, optPlayers]);
  const attendances = useMemo(() => {
    if (optAssign.size === 0 && optCreated.length === 0 && optEnded.size === 0 && optPlayers.size === 0) return snapshot.attendances;
    const playing = new Set(
      games.filter((g) => optAssign.has(g.id)).flatMap((g) => (g.players ?? []).map((p) => p.attendanceId)),
    );
    const matched = new Set(optCreated.flatMap((t) => t.ids));
    // 종료: 전원 대기 시간 리셋 + 게임 수 +1, 다른 조합에 들어 있으면 '대기 조합', 아니면 대기로(서버 finish와 같은 규칙)
    // 대기로: 조합이 그대로 대기 조합에 남으니 전원 '대기 조합'
    const finished = new Map<string, string>();
    const unassigned = new Set<string>();
    for (const g of snapshot.games) {
      const ended = g.status === 'PLAYING' ? optEnded.get(g.id) : undefined;
      if (!ended) continue;
      for (const p of g.players ?? []) {
        if (ended.kind === 'FINISHED') finished.set(p.attendanceId, ended.at);
        else unassigned.add(p.attendanceId);
      }
    }
    const inOtherGame = new Set(
      games.filter((g) => g.status === 'QUEUED' || g.status === 'PLAYING').flatMap((g) => (g.players ?? []).map((p) => p.attendanceId)),
    );
    // 조합에서 뺀 사람 — 다른 조합에도 없으면 서버처럼 대기로(대기 시간은 그대로)
    const removed = new Set<string>();
    for (const [id, patch] of optPlayers) {
      const kept = new Set(patch.players.map((p) => p.attendanceId));
      for (const p of snapshot.games.find((g) => g.id === id)?.players ?? []) if (!kept.has(p.attendanceId)) removed.add(p.attendanceId);
    }
    return snapshot.attendances.map((a) => {
      if (playing.has(a.id)) return { ...a, status: 'PLAYING' as const };
      const finishedAt = finished.get(a.id);
      if (finishedAt) {
        return {
          ...a,
          status: inOtherGame.has(a.id) ? ('MATCHED' as const) : ('CHECKED_IN' as const),
          waitingSince: finishedAt,
          gamesPlayed: a.gamesPlayed + 1,
        };
      }
      if (unassigned.has(a.id)) return { ...a, status: 'MATCHED' as const };
      if (removed.has(a.id) && a.status === 'MATCHED' && !inOtherGame.has(a.id)) return { ...a, status: 'CHECKED_IN' as const };
      return a.status === 'CHECKED_IN' && matched.has(a.id) ? { ...a, status: 'MATCHED' as const } : a;
    });
  }, [snapshot.attendances, snapshot.games, games, optAssign, optCreated, optEnded, optPlayers]);
  // 종료한 공유 코트는 서버처럼 '다른 모임 차례'로
  const courts = useMemo(() => {
    if (optEnded.size === 0) return snapshot.courts;
    const yielded = new Set(
      snapshot.games.filter((g) => g.status === 'PLAYING' && optEnded.get(g.id)?.kind === 'FINISHED').map((g) => g.courtId),
    );
    return snapshot.courts.map((c) => (c.isShared && yielded.has(c.id) ? { ...c, ourTurn: false } : c));
  }, [snapshot.courts, snapshot.games, optEnded]);
  const endGame = useCallback(
    (gameId: string, kind: 'FINISHED' | 'UNASSIGNED') => {
      // 이미 누른 게임·배정이 서버에 아직 안 닿은 게임(종료하면 409)은 무시
      if (optEnded.has(gameId) || optAssign.has(gameId)) return;
      setOptEnded((prev) => new Map(prev).set(gameId, { kind, at: new Date().toISOString() }));
      const path = kind === 'FINISHED' ? 'finish' : 'unassign';
      const clearEnded = () =>
        setOptEnded((prev) => {
          const next = new Map(prev);
          next.delete(gameId);
          return next;
        });
      const courtNo = snapshot.courts.find((c) => c.id === games.find((g) => g.id === gameId)?.courtId)?.courtNo;
      void runParallel(() => api(`/games/${gameId}/${path}`, { method: 'PATCH', admin: true })).then((ok) => {
        if (!ok) return clearEnded();
        if (kind !== 'FINISHED') return;
        // 잘못 누른 종료는 보통 바로 알아챈다 — 10초 동안 [되돌리기](서버는 30초까지 받는다)
        showToast(`${courtNo ? `${courtNo}번 코트 ` : ''}게임 종료`, 'success', 10_000, {
          label: '되돌리기',
          onClick: () => {
            hideToast();
            // 종료 덧씌움은 서버 화면이 '게임 중'인 동안 남는다 — 되돌린 게임이 계속 끝난 것처럼 보이지 않게 먼저 지운다
            clearEnded();
            void run(() => api(`/games/${gameId}/reopen`, { method: 'PATCH', admin: true }), `game:${gameId}`);
          },
        });
      });
    },
    [optEnded, optAssign, runParallel, run, snapshot.courts, games, showToast, hideToast],
  );
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const snapshotRef = useRef(snapshot); // 순서 요청이 줄을 서 있다 나갈 때 그때의 서버 화면을 보려고
  snapshotRef.current = snapshot;
  const patchPlayers = useCallback(
    (gameId: string, change: (players: GamePlayer[]) => GamePlayer[], request: () => Promise<unknown>) => {
      const server = snapshot.games.find((g) => g.id === gameId);
      const shown = gamesRef.current.find((g) => g.id === gameId);
      if (!server || !shown || gameId.startsWith(TEMP_GAME_PREFIX)) return;
      const players = change(shown.players ?? []);
      setOptPlayers((prev) => {
        const old = prev.get(gameId);
        return new Map(prev).set(gameId, {
          players,
          base: old?.base ?? playersSignature(server.players),
          pending: (old?.pending ?? 0) + 1,
        });
      });
      void runParallel(request).then((ok) => {
        setOptPlayers((prev) => {
          const patch = prev.get(gameId);
          if (!patch) return prev;
          const next = new Map(prev);
          if (!ok) next.delete(gameId); // 실패 — 서버 화면대로(알림은 runParallel)
          else next.set(gameId, { ...patch, pending: patch.pending - 1 });
          return next;
        });
        // 서버 목록이 결국 처음과 같아졌으면(바꿨다 되돌림) 지울 계기가 없다 — 새로고침이 올 만큼 기다렸다 지운다
        setTimeout(
          () =>
            setOptPlayers((prev) => {
              if (prev.get(gameId)?.pending !== 0) return prev;
              const next = new Map(prev);
              next.delete(gameId);
              return next;
            }),
          2000,
        );
      });
    },
    [snapshot.games, runParallel],
  );
  const slotActions = useMemo(
    () => ({
      // 그 자리에 사람이 있으면 맞바꾸고, 비어 있으면 그 자리로(서버 moveSlot과 같은 규칙)
      moveSlot: (gameId: string, attendanceId: string, slot: number) =>
        patchPlayers(
          gameId,
          (players) => {
            const mover = players.find((p) => p.attendanceId === attendanceId);
            if (!mover || mover.slot === slot) return players;
            return players.map((p) =>
              p.attendanceId === attendanceId ? { ...p, slot } : p.slot === slot ? { ...p, slot: mover.slot } : p,
            );
          },
          () => api(`/games/${gameId}/slots`, { method: 'PATCH', admin: true, body: { attendanceId, slot } }),
        ),
      removePlayer: (gameId: string, attendanceId: string) =>
        patchPlayers(
          gameId,
          (players) => players.filter((p) => p.attendanceId !== attendanceId),
          () => api(`/games/${gameId}/players/${attendanceId}`, { method: 'DELETE', admin: true }),
        ),
    }),
    [patchPlayers],
  );
  const assignToCourt = useCallback(
    (gameId: string, courtId: string) => {
      if (gameId.startsWith(TEMP_GAME_PREFIX) || optAssign.has(gameId)) return; // 아직 서버에 없는 조합·이미 누른 조합
      setOptAssign((prev) => new Map(prev).set(gameId, { courtId, startedAt: new Date().toISOString() }));
      void runParallel(() => api(`/games/${gameId}/assign`, { method: 'PATCH', admin: true, body: { courtId } })).then((ok) => {
        if (ok) return;
        setOptAssign((prev) => {
          const next = new Map(prev);
          next.delete(gameId);
          return next;
        });
      });
    },
    [optAssign, runParallel],
  );

  const playingByCourt = useMemo(() => {
    const map = new Map<string, IGame>();
    for (const game of games) {
      if (game.status === 'PLAYING' && game.courtId) map.set(game.courtId, game);
    }
    return map;
  }, [games]);
  // 끌어서 바꾼 순서 — 다음 실시간 화면이 오면 버린다(그때는 서버 순서가 같아져 있다)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  // 순서 요청은 누른 순서대로 한 줄로 보낸다(늦게 보낸 게 먼저 닿아 순서가 뒤집히지 않게). 보내는 중엔 보여 주던 순서를 유지
  const orderChain = useRef<Promise<unknown>>(Promise.resolve());
  const orderPending = useRef(0);
  useEffect(() => {
    if (orderPending.current === 0) setPendingOrder(null);
  }, [snapshot.games]);
  const queuedGames = useMemo(() => {
    const list = games.filter((g) => g.status === 'QUEUED');
    if (!pendingOrder) return list;
    const rank = new Map(pendingOrder.map((id, index) => [id, index]));
    return [...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }, [games, pendingOrder]);

  // 대기 조합 순서 바꾸기(끌기·▲▼) — 바로 그 순서로 보여 주고 서버엔 전체 순서를 보낸다.
  // 서버는 대기 조합 전체가 맞아야 받으므로, 아직 서버에 없는 조합(만드는 중·대기로 돌리는 중)은 빼고 서버에만 있는 건 뒤에 붙인다
  const reorderQueue = (next: string[]) => {
    setPendingOrder(next);
    orderPending.current += 1;
    orderChain.current = orderChain.current.then(async () => {
      const serverQueued = snapshotRef.current.games.filter((g) => g.status === 'QUEUED').map((g) => g.id);
      const known = new Set(serverQueued);
      const ids = next.filter((id) => known.has(id));
      ids.push(...serverQueued.filter((id) => !ids.includes(id)));
      const ok = await runParallel(() =>
        api(`/sessions/${session.id}/games/order`, { method: 'PATCH', admin: true, body: { gameIds: ids } }),
      );
      orderPending.current -= 1;
      if (!ok) setPendingOrder(null);
    });
  };
  const moveQueue = (gameId: string, delta: -1 | 1) => {
    const ids = queuedGames.map((g) => g.id);
    const from = ids.indexOf(gameId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    reorderQueue(arrayMove(ids, from, to));
  };
  // 끌어다 놓기 → 서버 호출. 카드에서 끌어낸 사람은 자석을 옮기듯 원래 조합에서 빠진다
  const onDrop = useCallback(
    (item: DragItem, target: DropTarget | null) => {
      if (item.kind === 'game') {
        if (target?.kind === 'court') {
          assignToCourt(item.gameId, target.courtId);
          return;
        }
        if (target?.kind !== 'card') return;
        // 놓은 카드 자리로 — 그 카드와 사이의 조합들이 한 칸씩 밀린다
        const ids = queuedGames.map((g) => g.id);
        const from = ids.indexOf(item.gameId);
        const to = ids.indexOf(target.gameId);
        if (from < 0 || to < 0 || from === to) return;
        reorderQueue(arrayMove(ids, from, to));
        return;
      }
      const person = item;
      const from = person.fromGameId;
      const body = { attendanceId: person.attendanceId };
      const leaveOrigin = () =>
        from
          ? api(`/games/${from}/players/${person.attendanceId}`, { method: 'DELETE', admin: true })
          : Promise.resolve();
      // 아무 데도 아닌 곳·명단 = 카드에서 떼어 내기(명단에서 끈 거면 아무 일 없음)
      if (!target || target.kind === 'roster') {
        if (from) slotActions.removePlayer(from, person.attendanceId);
        return;
      }
      if (target.kind === 'new-game') {
        void run(async () => {
          await api(`/sessions/${session.id}/games/draft`, { method: 'POST', admin: true, body });
          await leaveOrigin();
        });
        return;
      }
      // 같은 카드 안에 놓으면 자리 바꾸기(팀) — 사람 위면 맞바꾸고 빈칸이면 그 자리로
      const moveSlot = (slot: number | undefined) => {
        if (slot === undefined || !from) return;
        slotActions.moveSlot(from, person.attendanceId, slot);
      };
      if (target.kind === 'player' && target.gameId === from) {
        if (target.attendanceId === person.attendanceId) return;
        const slot = queuedGames.find((g) => g.id === from)?.players?.find((p) => p.attendanceId === target.attendanceId)?.slot;
        moveSlot(slot);
        return;
      }
      if (target.kind === 'slot' && target.gameId === from) {
        moveSlot(target.slot);
        return;
      }
      if (target.kind === 'player') {
        if (target.attendanceId === person.attendanceId) return;
        void run(async () => {
          await api(`/games/${target.gameId}/players`, {
            method: 'PATCH',
            admin: true,
            body: { outAttendanceId: target.attendanceId, inAttendanceId: person.attendanceId },
          });
          await leaveOrigin();
        });
        return;
      }
      // 빈칸 또는 빈칸 있는 카드의 여백 — 같은 카드거나 다 찬 카드면 그대로(사람은 코트 자체엔 못 놓는다)
      if (target.kind === 'court' || target.gameId === from || (target.kind === 'card' && target.full)) return;
      // 빈칸에 놓았으면 그 자리로(팀이 정해진다), 카드 여백이면 첫 빈자리
      const addBody = target.kind === 'slot' ? { ...body, slot: target.slot } : body;
      void run(async () => {
        await api(`/games/${target.gameId}/players`, { method: 'POST', admin: true, body: addBody });
        await leaveOrigin();
      });
    },
    [run, session.id, queuedGames, assignToCourt, slotActions],
  );
  // 폰: 조합 카드를 끄는 동안 구역 좌우 넘기기가 끼어들지 않게
  const dndDragging = useRef(false);
  const onDraggingChange = useCallback((dragging: boolean) => {
    dndDragging.current = dragging;
  }, []);
  const idleCourts = useMemo(
    () => courts.filter((c) => !playingByCourt.has(c.id)),
    [courts, playingByCourt],
  );
  // [빈 코트 채우기]로 들어갈 조합 수 — 서버 fillCourts와 같은 규칙(공유 코트는 우리 차례만, 게임 중인 사람이 든 조합은 건너뜀)
  const fillableCount = useMemo(() => {
    let free = idleCourts.filter((c) => !c.isShared || c.ourTurn).length;
    const busyIds = new Set(attendances.filter((a) => a.status === 'PLAYING').map((a) => a.id));
    let count = 0;
    for (const game of queuedGames) {
      if (free === 0) break;
      if (!isFullGame(game)) continue; // 빈칸 있는 조합은 서버도 건너뛴다
      const ids = (game.players ?? []).map((p) => p.attendanceId);
      if (ids.some((id) => busyIds.has(id))) continue;
      ids.forEach((id) => busyIds.add(id));
      free -= 1;
      count += 1;
    }
    return count;
  }, [idleCourts, queuedGames, attendances]);
  const [fillNotice, setFillNotice] = useState<string | null>(null);
  const fillNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (fillNoticeTimer.current) clearTimeout(fillNoticeTimer.current);
  }, []);
  const fillCourts = () =>
    void run(async () => {
      const result = await api<IFillCourtsResult>(`/sessions/${session.id}/fill-courts`, {
        method: 'POST',
        admin: true,
      });
      // 결과는 구역 안에 몇 초 보여 준다(보드 토스트는 오류 전용 빨간색이라)
      const lines = [
        ...result.assigned.map((a) => `${a.courtNo}번 코트 ← ${a.names[0]} 외 ${a.names.length - 1}명`),
        ...result.skipped.map((s) => `건너뜀: ${s.reason}`),
      ];
      setFillNotice(lines.length > 0 ? lines.join(' · ') : '배정할 조합이 없어요');
      if (fillNoticeTimer.current) clearTimeout(fillNoticeTimer.current);
      fillNoticeTimer.current = setTimeout(() => setFillNotice(null), 5000);
    }, 'fill-courts');

  // 콕 확인 대기 — 확인 전엔 게임 배정이 막히므로 대기 인원과 분리해 구역 맨 위에 모은다
  // (운영진은 이 섹션이 비었는지만 확인하면 된다)
  // 콕 확인은 누르자마자 반영한다 — 서버 응답·화면 새로고침(두 번 오감)을 기다리면 멈춘 것처럼 보이고,
  // 여러 명을 연달아 누를 때 앞사람이 끝나기 전 누른 건 무시됐다. 서버 화면에 확인이 실리면 이 표시는 지운다
  const [confirming, setConfirming] = useState<Map<string, string>>(new Map()); // 출석 id → 누른 시각
  useEffect(() => {
    setConfirming((prev) => {
      const next = new Map([...prev].filter(([id]) => !attendances.find((a) => a.id === id)?.shuttleConfirmedAt));
      return next.size === prev.size ? prev : next;
    });
  }, [attendances]);
  const shuttleView = useMemo(
    () =>
      confirming.size === 0
        ? attendances
        : attendances.map((a) => {
            const at = confirming.get(a.id);
            return at && !a.shuttleConfirmedAt ? { ...a, shuttleConfirmedAt: at, waitingSince: at } : a;
          }),
    [attendances, confirming],
  );
  const confirmShuttle = (attendanceId: string) => {
    if (confirming.has(attendanceId)) return;
    setConfirming((prev) => new Map(prev).set(attendanceId, new Date().toISOString()));
    void runParallel(() => api(`/attendances/${attendanceId}/shuttle`, { method: 'PATCH', admin: true })).then((ok) => {
      if (ok) return;
      setConfirming((prev) => {
        const next = new Map(prev);
        next.delete(attendanceId); // 실패 — 콕 확인 대기로 되돌린다(알림은 runParallel이 띄움)
        return next;
      });
    });
  };
  // 명단과 같은 규칙 — 모임장 → 운영진을 맨 위에(현장에서 찾기 쉽게), 나머지는 스냅샷 순서
  const pendingShuttle = useMemo(
    () =>
      shuttleView
        .filter((a) => a.status !== 'LEFT' && !a.shuttleConfirmedAt)
        .sort((a, b) => roleRank(a) - roleRank(b)),
    [shuttleView],
  );
  // 명단 — 콕 확인된 출석자 전원(조합에 넣어도 사라지지 않는 자석판 명단). 비어 있는 사람(오래 기다린 순)이 위
  // 명단·빈칸 채우기·선수 교체가 같이 쓰는 정렬 — 이 기기에 기억
  const [rosterSort, setRosterSortState] = useState<RosterSort>(readRosterSort);
  const setRosterSort = (sort: RosterSort) => {
    setRosterSortState(sort);
    try {
      localStorage.setItem(ROSTER_SORT_KEY, sort);
    } catch {
      // 저장 못 해도 이번 화면에선 바뀐다
    }
  };
  const roster = useMemo(() => sortRoster(shuttleView, rosterSort), [shuttleView, rosterSort]);
  // 대회 연습 파트너 — 서로를 가리키는 쌍만(퇴장·취소로 한쪽만 남은 값은 무시)
  const partnerNames = useMemo(() => {
    const byId = new Map(attendances.filter((a) => a.status !== 'LEFT').map((a) => [a.id, a]));
    const names = new Map<string, string>();
    for (const a of byId.values()) {
      const partner = a.partnerAttendanceId ? byId.get(a.partnerAttendanceId) : undefined;
      if (partner?.partnerAttendanceId === a.id && partner.member) names.set(a.id, partner.member.name);
    }
    return names;
  }, [attendances]);
  const waitingCount = roster.filter((a) => a.status === 'CHECKED_IN').length;
  // 이름 옆 위치 표시 — "조합 2, 3"·"1번 코트" (사람 → 들어 있는 대기 조합 순번들 / 코트 번호)
  const placeLabels = useMemo(
    () => buildPlaceLabels(queuedGames, playingByCourt, courts),
    [queuedGames, playingByCourt, courts],
  );
  // 중복 대기 허용 — 두 개 이상의 대기 조합에 들어간 인원 (카드에 "겹침" 표시)
  const overlapIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of queuedGames) {
      for (const player of game.players ?? []) {
        counts.set(player.attendanceId, (counts.get(player.attendanceId) ?? 0) + 1);
      }
    }
    return new Set([...counts].filter(([, count]) => count >= 2).map(([id]) => id));
  }, [queuedGames]);
  // 모달이 열린 동안에도 실시간 스냅샷을 따라가도록 id로 파생 — 게임이 끝나/해체되면 자동으로 닫힘
  // 코트 고르기 대상 — 실시간 스냅샷 기준, 이미 배정·해체됐으면 시트가 저절로 닫힌다
  const assignTarget = useMemo(
    () => games.find((g) => g.id === assignGameId && g.status === 'QUEUED') ?? null,
    [games, assignGameId],
  );
  // 코트 옮기기 대상 — 게임이 끝나면 시트가 저절로 닫힌다
  const moveTarget = useMemo(
    () => games.find((g) => g.id === moveGameId && g.status === 'PLAYING') ?? null,
    [games, moveGameId],
  );
  // 카드 [⋯] 대상 — 실시간 스냅샷 기준, 게임이 끝나거나 해체되면 저절로 닫힌다
  const cardMenuTarget = useMemo(
    () => games.find((g) => g.id === cardMenuId && (g.status === 'PLAYING' || g.status === 'QUEUED')) ?? null,
    [games, cardMenuId],
  );
  // [⋯] 대상 — 실시간 스냅샷 기준, 퇴장·콕 취소되면 저절로 닫힌다
  const actionTarget = useMemo(
    () => attendances.find((a) => a.id === actionId && a.status !== 'LEFT' && a.shuttleConfirmedAt) ?? null,
    [attendances, actionId],
  );
  const replaceTarget = useMemo(
    () =>
      games.find(
        (g) => g.id === replaceGameId && (g.status === 'PLAYING' || g.status === 'QUEUED'),
      ) ?? null,
    [games, replaceGameId],
  );
  // 빈칸 채우기 대상 — 실시간 스냅샷 기준, 다 차거나 배정·해체되면 시트가 저절로 닫힌다
  const slotLive = slotTarget?.gameId ? games.find((g) => g.id === slotTarget.gameId) : undefined;
  const slotGame = slotLive
    ? slotLive.status === 'QUEUED' && !isFullGame(slotLive)
      ? slotLive
      : null
    : (slotTarget?.pending ?? null);
  const slotOpen = slotTarget !== null && (slotTarget.gameId === null || slotGame !== null);
  // 실시간 화면에 나타나면 대신 보여 주던 것은 버린다(이후 해체되면 시트가 닫히게)
  useEffect(() => {
    if (slotLive && slotTarget?.pending) setSlotTarget({ gameId: slotLive.id });
  }, [slotLive, slotTarget]);
  const leftCount = attendances.filter((a) => a.status === 'LEFT').length;
  const presentCount = attendances.length - leftCount;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  };

  // 4명이면 바로 조합, 1~3명이면 빈칸 있는 조합(나머지는 빈칸을 눌러 채우거나 끌어다 놓는다)
  // 누르면 선택을 비우고 대기 조합 맨 끝에 바로 보여 준 뒤 서버에 보낸다
  const createGame = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setSelected(new Set());
    const tempId = `${TEMP_GAME_PREFIX}${Date.now()}`;
    const temp: IGame = {
      id: tempId,
      sessionId: session.id,
      courtId: null,
      status: 'QUEUED',
      queuedAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      queueOrder: null,
      players: ids.map((attendanceId, slot) => ({
        id: `${tempId}:${slot}`,
        gameId: tempId,
        attendanceId,
        slot,
        attendance: snapshot.attendances.find((a) => a.id === attendanceId),
      })),
    };
    setOptCreated((prev) => [...prev, { game: temp, ids }]);
    const drop = () => setOptCreated((prev) => prev.filter((t) => t.game.id !== tempId));
    void runParallel(async () => {
      try {
        if (ids.length === GAME_SIZE) {
          await api(`/sessions/${session.id}/games`, { method: 'POST', admin: true, body: { attendanceIds: ids } });
        } else {
          const draft = await api<IGame>(`/sessions/${session.id}/games/draft`, {
            method: 'POST',
            admin: true,
            body: { attendanceId: ids[0] },
          });
          setOptCreated((prev) => prev.map((t) => (t.game.id === tempId ? { ...t, realId: draft.id } : t)));
          for (const attendanceId of ids.slice(1)) {
            await api(`/games/${draft.id}/players`, { method: 'POST', admin: true, body: { attendanceId } });
          }
        }
      } catch (error) {
        drop(); // 실패 — 대기로 되돌린다(빈칸 조합이 일부만 만들어졌으면 그 조합이 서버 화면대로 남는다)
        throw error;
      }
      setTimeout(drop, 5000); // 실시간 화면을 못 받아도 새로고침으로 실린 뒤엔 대신 보여 주던 것을 버린다
    });
  };

  const closeSession = () => {
    if (!confirmClose) {
      setConfirmClose(true);
      setTimeout(() => setConfirmClose(false), 4000); // 4초 내 재탭 시 종료
      return;
    }
    // 모임 종료 = 그날 운영 끝 → 마무리 문구를 띄우고, 그걸 닫으면 패스코드를 지우고 게이트로(Board가 처리)
    // (예전엔 홈으로 보냈지만, 홈은 관제판 앱 scope 밖이라 설치 상태에선 앱을 벗어나 버린다)
    void run(async () => {
      await api(`/sessions/${session.id}/close`, { method: 'PATCH', admin: true });
      onSessionClosed(session.id);
    });
  };

  // 폰에서는 구역 4개를 가로로 늘어놓고(.board-track) 현재 탭 위치로 민다, md 이상은 그리드로 동시 표시
  // max-md:flex-none — 대기·메모 구역에 붙은 태블릿용 flex-1(폭 0에서 나눠 갖기)이 폰에서 이기면 폭이 내용 폭으로 바뀌어
  // 구역마다 폭이 어긋나고 옆 구역이 밀린다. 폰에서는 늘이지도 줄이지도 않고 정확히 화면 폭(w-full)
  const pane = 'flex min-h-0 flex-col gap-3 max-md:w-full max-md:flex-none';

  // 더보기 시트의 항목 — 폰·태블릿 공용(태블릿 머리에는 체크인 코드·게임 기록만 따로 펼친다)
  const headerActions: {
    key: string;
    label: string;
    keepMenuOpen?: boolean; // 2탭 확인·토글이라 메뉴를 닫으면 안 되는 것
    onClick: () => void;
  }[] = [
    {
      key: 'code',
      label: '입장 코드',
      onClick: () => setCodeOpen(true),
    },
    {
      key: 'log',
      label: '게임 기록',
      onClick: () => setGamesLogOpen(true),
    },
    {
      key: 'history',
      label: '지난 기록',
      // 화면 이동 — 더보기 시트를 먼저 닫으면 그 뒤로가기 정리(history.go)가 이동을 되돌릴 수 있어, 닫지 않고 이동한다(이동하면 시트도 사라짐)
      keepMenuOpen: true,
      onClick: () => router.push('/admin/history'),
    },
    {
      key: 'members',
      label: '모임원 관리',
      onClick: () => setMembersOpen(true),
    },
    {
      key: 'birthday',
      label: '생일',
      onClick: () => setBirthdayOpen(true),
    },
    {
      key: 'entryFee',
      label: '입장비',
      onClick: () => setEntryFeeOpen(true),
    },
    {
      key: 'settlement',
      label: '정산',
      onClick: () => setSettlementOpen(true),
    },
    {
      key: 'courts',
      label: '코트 관리',
      onClick: () => setCourtsOpen(true),
    },
    {
      key: 'display',
      label: '전광판 열기 — 모임원에게 보여 줄 화면',
      // 새 창(설치본이면 브라우저)으로 — 관제판은 그대로 두고 태블릿·TV에 띄운다. 운영진 로그인 없이 열리는 보기 전용 화면
      onClick: () => window.open('/board', '_blank', 'noopener'),
    },
    {
      key: 'help',
      label: '도움말',
      onClick: () => setHelpOpen(true),
    },
  ];

  const MOBILE_TABS: { value: MobileTab; label: string; count?: number }[] = [
    { value: 'courts', label: '게임 중', count: playingByCourt.size },
    { value: 'queue', label: '조합', count: queuedGames.length },
    { value: 'waiting', label: '명단', count: waitingCount },
    { value: 'memo', label: '메모' },
  ];

  // 폰에서 구역 간 가로 스와이프 이동 — 미는 동안 화면과 탭 표시가 손가락을 따라오고, 놓으면 옆 탭으로 넘어간다
  // (md 이상은 구역이 동시에 보이므로 무시)
  const tabIndex = MOBILE_TABS.findIndex((tab) => tab.value === mobileTab);
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
    if (dndDragging.current) {
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
    const atEnd = (dx > 0 && tabIndex === 0) || (dx < 0 && tabIndex === MOBILE_TABS.length - 1);
    s.dx = atEnd ? dx * 0.3 : dx;
    setDrag(s.dx);
  };

  const onTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.dir !== 'h') return;
    boardRef.current?.removeAttribute('data-dragging'); // 전환 애니메이션 다시 켜기 → 놓은 자리에서 제자리/옆 탭으로 미끄러진다
    const width = boardRef.current?.clientWidth ?? window.innerWidth;
    const next =
      Math.abs(s.dx) >= Math.min(SWIPE_COMMIT_PX, width * 0.25)
        ? MOBILE_TABS[tabIndex + (s.dx < 0 ? 1 : -1)] // 양 끝에서는 undefined라 제자리로 돌아간다
        : undefined;
    setDrag(0);
    if (next) setMobileTab(next.value);
  };

  return (
    <main
      ref={boardRef}
      style={{ '--tab-index': tabIndex } as React.CSSProperties}
      className="fade-in flex h-dvh flex-col overflow-x-hidden p-2 md:p-4"
    >
      {/* 설치 안내 — 카톡으로 연 운영진도 브라우저로 나가게. 설치된 앱에선 뜨지 않는다 */}
      <InstallPrompt app="admin" className="mb-2 shrink-0" />
      {/* 헤더 */}
      {/* 머리 — 태블릿은 자주 쓰는 두 개(체크인 코드·게임 기록)만 펼치고 나머지는 폰과 같은 더보기 시트로 */}
      <header className="flex items-center gap-2 pb-2 md:gap-3 md:pb-3">
        <HomeLink className="shrink-0 transition-opacity hover:opacity-70" title="홈으로">
          <h1 className="text-body font-bold md:text-heading">
            렛츠콕 <span className="text-court">운영</span>
          </h1>
        </HomeLink>
        <p className="truncate text-caption text-dim md:text-body-sm">
          {session.date} · 출석 {presentCount}명
        </p>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <button
            onClick={() => setCodeOpen(true)}
            className="h-11 rounded-xl bg-court/15 px-4 text-body-sm font-bold text-court"
          >
            입장 코드
          </button>
          <button
            onClick={() => setGamesLogOpen(true)}
            className="h-11 rounded-xl bg-panel px-4 text-body-sm font-medium text-dim"
          >
            게임 기록
          </button>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="더보기"
          className="tap ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-panel text-dim md:ml-0 md:h-11 md:w-11"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* 3구역 — 폰: 탭 1구역 / 태블릿 세로: 2열(게임 중 | 조합+대기) / 데스크톱: 3열 */}
      <BoardDnd onDrop={onDrop} onDraggingChange={onDraggingChange}>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className="board-track flex min-h-0 flex-1 md:grid md:grid-cols-2 md:grid-rows-2 md:gap-3 lg:grid-cols-[1.15fr_1fr_1fr] lg:grid-rows-1"
      >
        <div className={`${pane} md:row-span-2 lg:row-span-1`}>
        <Zone
          title="게임 중"
          accent="text-court"
          count={playingByCourt.size}
          className="flex-1"
          // 코트는 이 구역에 보이니 여기서 바로 고친다 — 메뉴 깊이 있어 찾기 어렵다는 피드백(더보기·헤더 입구도 그대로 둠)
          headerExtra={
            <button
              onClick={() => setCourtsOpen(true)}
              className="tap ml-auto h-8 rounded-lg bg-panel2 px-3 text-caption font-medium text-dim"
            >
              코트 관리
            </button>
          }
        >
          {courts.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-faint">오늘 쓰는 코트를 먼저 등록해주세요</p>
              <button
                onClick={() => setCourtsOpen(true)}
                className="h-11 rounded-xl bg-court px-5 text-sm font-bold text-bg"
              >
                + 코트 추가하기
              </button>
            </div>
          )}
          <AnimatePresence initial={false}>
            {courts.map((court) => (
              <CourtCard
                key={court.id}
                court={court}
                game={playingByCourt.get(court.id)}
                now={now}
                run={run}
                slotActions={slotActions}
                onEnd={endGame}
                onMore={(g) => setCardMenuId(g.id)}
                dragEnabled={dragEnabled}
              />
            ))}
          </AnimatePresence>
        </Zone>
        </div>

        <div className={pane}>
        <Zone
          title="대기 조합"
          accent="text-amber"
          count={queuedGames.length}
          className="flex-1"
          headerExtra={
            fillableCount > 0 && (
              <button
                onClick={fillCourts}
                disabled={busy}
                title="빈 코트에 대기 조합을 순서대로 한 번에 배정해요"
                className="ml-auto h-8 shrink-0 rounded-lg bg-amber px-3 text-caption font-bold text-bg disabled:opacity-50"
              >
                빈 코트 채우기 ({fillableCount})
              </button>
            )
          }
        >
          {fillNotice && (
            <p className="rounded-[10px] bg-amber/10 px-3 py-2 text-caption font-medium whitespace-normal text-amber">
              {fillNotice}
            </p>
          )}
          {queuedGames.length === 0 && <Empty>명단에서 사람을 골라 조합을 만들어주세요</Empty>}
          <AnimatePresence initial={false}>
            {queuedGames.map((game, index) => (
              <QueueCard
                key={game.id}
                game={game}
                order={index + 1}
                neighborUp={queuedGames[index - 1]}
                neighborDown={queuedGames[index + 1]}
                idleCourts={idleCourts}
                overlapIds={overlapIds}
                run={run}
                slotActions={slotActions}
                onMore={(g) => setCardMenuId(g.id)}
                onPickCourt={(g) => setAssignGameId(g.id)}
                onAssign={assignToCourt}
                onMove={moveQueue}
                onFillSlot={(g) => setSlotTarget({ gameId: g.id })}
                onRecommend={(g) => setRecommendFillId(g.id)}
                dragEnabled={dragEnabled}
              />
            ))}
          </AnimatePresence>
          <NewGameSlot dragEnabled={dragEnabled} onClick={() => setSlotTarget({ gameId: null })} />
        </Zone>
        </div>

        {/* 대기 인원 + 운영 메모 — md 이상은 한 컬럼 세로 분할, 폰은 각각 별도 탭(래퍼가 사라져 두 구역이 트랙에 바로 놓인다) */}
        <div className="flex min-h-0 flex-col gap-3 max-md:contents">
        <RosterDrop className={`${pane} flex-1`} dragEnabled={dragEnabled}>
        <Zone
          title="명단"
          accent="text-ink"
          count={roster.length}
          className="flex-1"
          headerExtra={
            <div className="ml-auto flex items-center gap-2">
              {/* 이스터에그 히든 존 — [수동 체크인]과 같은 크기의 보이지 않는 영역, 13연타로 발동 */}
              <span
                onClick={handleCheerTap}
                aria-hidden
                className="h-7 w-[74px] cursor-default"
              />
              <RosterSortSelect value={rosterSort} onChange={setRosterSort} />
              <button
                onClick={() => setManualOpen(true)}
                className="tap h-8 rounded-lg bg-panel2 px-3 text-caption font-medium text-dim"
              >
                출석 추가
              </button>
            </div>
          }
          footer={
            <>
              <button
                onClick={() => setCommandOpen(true)}
                aria-label="AI 명령 — 말하듯 적어서 게임 짜기·종료·휴식·호출·출석"
                title="AI 명령"
                className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-panel2 text-court"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <path d="M12 17v4" />
                </svg>
              </button>
              <button
                onClick={() => setRecommendOpen(true)}
                disabled={busy}
                className="h-13 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-court disabled:opacity-50"
              >
                게임 추천
              </button>
              <button
                onClick={createGame}
                disabled={selected.size === 0 || busy}
                className="h-13 flex-1 rounded-xl bg-amber text-body font-bold text-bg disabled:bg-panel2 disabled:text-faint"
              >
                {selected.size > 0 && selected.size < GAME_SIZE ? '빈칸 조합' : '조합 만들기'} ({selected.size}/4)
              </button>
            </>
          }
        >
          {pendingShuttle.length > 0 && (
            <>
              <div className="flex items-center gap-2 pb-1">
                <p className="min-w-0 flex-1 text-caption font-medium text-amber">
                  콕 확인 대기 {pendingShuttle.length}명 — [콕 확인]을 누르면 명단으로 내려가요
                </p>
                {/* 한꺼번에 콕을 냈을 때 — 두 번 눌러야 실행(콕을 안 낸 사람까지 확인되는 실수 방지) */}
                {pendingShuttle.length >= 2 && (
                  <ConfirmButton
                    label={`모두 콕 확인 (${pendingShuttle.length})`}
                    confirmLabel={`${pendingShuttle.length}명 모두 확인`}
                    title="콕 확인 대기 전원을 한 번에 확인"
                    onConfirm={() => pendingShuttle.forEach((a) => confirmShuttle(a.id))}
                    className="tap h-9 shrink-0 rounded-lg px-3 text-caption font-bold"
                    idleCls="bg-amber text-bg"
                  />
                )}
              </div>
              <AnimatePresence initial={false}>
                {pendingShuttle.map((attendance) => (
                  <ShuttleRow key={attendance.id} attendance={attendance} run={run} onConfirm={confirmShuttle} />
                ))}
              </AnimatePresence>
              <div className="mb-1 border-b border-line" />
            </>
          )}
          {roster.length === 0 && pendingShuttle.length === 0 && (
            <Empty>출석한 사람이 없어요</Empty>
          )}
          {/* 비어 있는 사람 → 조합에 든 사람 → 게임 중 → 휴식. 조합·게임에 든 사람도 겹쳐 넣을 수 있어 선택은 된다 */}
          <AnimatePresence initial={false}>
            {roster.map((attendance) => (
              <WaitingRow
                key={attendance.id}
                onMore={(a) => setActionId(a.id)}
                attendance={attendance}
                now={now}
                selected={selected.has(attendance.id)}
                onToggle={() => toggleSelect(attendance.id)}
                run={run}
                busyStatus={
                  attendance.status === 'PLAYING' || attendance.status === 'MATCHED' ? attendance.status : undefined
                }
                placeLabel={placeLabels.get(attendance.id)}
                resting={attendance.status === 'RESTING'}
                dragEnabled={dragEnabled}
                partnerName={partnerNames.get(attendance.id)}
              />
            ))}
          </AnimatePresence>
          {leftCount > 0 && (
            <p className="pt-2 text-center text-xs text-faint">퇴장 {leftCount}명</p>
          )}
        </Zone>
        </RosterDrop>
        <div className={`${pane} flex-1 md:max-h-[35%] md:flex-none`}>
          <MemoPanel snapshot={snapshot} run={run} busy={busy} />
        </div>
        </div>
      </div>
      </BoardDnd>

      {/* 구역 탭 — 폰에서만, 화면 맨 아래(엄지 자리). md 이상은 3열로 동시 표시.
          선택 표시(.board-tab-indicator)가 스와이프를 따라 미끄러진다 */}
      <nav aria-label="구역" className="relative mt-2 flex shrink-0 rounded-2xl bg-panel p-1 md:hidden">
        <span
          aria-hidden
          className="board-tab-indicator absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-xl bg-court/15"
        />
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setMobileTab(tab.value)}
            aria-current={mobileTab === tab.value ? 'page' : undefined}
            className={`relative flex h-12 flex-1 items-center justify-center gap-1 rounded-xl text-sm font-bold transition-colors ${
              mobileTab === tab.value ? 'text-court' : 'text-dim'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`tabular min-w-5 rounded-full px-1.5 font-mono text-caption leading-5 ${
                  mobileTab === tab.value ? 'bg-court text-bg' : 'bg-line text-ink'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {recommendOpen && (
        <RecommendModal
          sessionId={session.id}
          attendances={attendances}
          run={run}
          busy={busy}
          onClose={() => setRecommendOpen(false)}
        />
      )}
      {/* 빈자리 추천 — 실시간 화면 기준으로 찾아서, 조합이 다 차거나 없어지면 저절로 닫힌다 */}
      {(() => {
        const fillGame = recommendFillId ? queuedGames.find((g) => g.id === recommendFillId) : undefined;
        return (
          fillGame &&
          !isFullGame(fillGame) && (
            <RecommendModal
              sessionId={session.id}
              attendances={attendances}
              fillGame={fillGame}
              run={run}
              busy={busy}
              onClose={() => setRecommendFillId(null)}
            />
          )
        );
      })()}
      {codeOpen && <CheckInCodeModal onClose={() => setCodeOpen(false)} />}
      {membersOpen && <MembersManagerModal onClose={() => setMembersOpen(false)} />}
      {birthdayOpen && <BirthdayCalendarModal onClose={() => setBirthdayOpen(false)} />}
      {settlementOpen && <SettlementModal onClose={() => setSettlementOpen(false)} />}
      {entryFeeOpen && <EntryFeeSheet sessionId={session.id} onClose={() => setEntryFeeOpen(false)} />}
      {cheer && <CheerEasterEgg onDone={closeCheer} />}
      {manualOpen && (
        <ManualCheckInModal
          sessionId={session.id}
          attendances={attendances}
          run={run}
          busy={busy}
          onClose={() => setManualOpen(false)}
        />
      )}
      {gamesLogOpen && (
        <TodayGamesModal
          sessionId={session.id}
          snapshot={snapshot}
          onClose={() => setGamesLogOpen(false)}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {courtsOpen && (
        <CourtsManager
          sessionId={session.id}
          courts={courts}
          playingByCourt={playingByCourt}
          runParallel={runParallel}
          onClose={() => setCourtsOpen(false)}
        />
      )}
      {/* 코트 고르기 — 대기 조합 카드는 보드 트랙(transform) 안이라 시트를 여기(바깥)에서 띄운다 */}
      {assignTarget && (
        <CourtPickSheet
          game={assignTarget}
          idleCourts={idleCourts}
          onAssign={assignToCourt}
          onClose={() => setAssignGameId(null)}
        />
      )}
      {/* 게임 중 조합 코트 옮기기 — 게임 시간은 이어진다 */}
      {moveTarget && (
        <CourtPickSheet
          game={moveTarget}
          idleCourts={idleCourts}
          title={`${courts.find((c) => c.id === moveTarget.courtId)?.courtNo ?? ''}번 코트에서 어디로 옮길까요?`}
          onAssign={(gameId, courtId) =>
            void run(
              () => api(`/games/${gameId}/court`, { method: 'PATCH', admin: true, body: { courtId } }),
              `game:${gameId}`,
            )
          }
          onClose={() => setMoveGameId(null)}
        />
      )}
      {/* 폰 더보기 — 햄버거가 보드를 밀어내던 격자 대신 아래에서 올라오는 목록. 위험한 항목은 맨 아래 따로 */}
      {menuOpen && (
        <Sheet
          ariaLabel="더보기"
          onClose={() => setMenuOpen(false)}
          header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap">더보기</h2>}
          bodyClassName="flex min-h-0 flex-1 flex-col gap-4 pb-1 scroll-area"
        >
          {MORE_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-1.5">
              <p className="px-1 text-caption font-bold text-dim">{group.title}</p>
              <div className="flex flex-col overflow-hidden rounded-2xl bg-panel2">
                {group.keys.map((key) => {
                  const action = headerActions.find((a) => a.key === key);
                  if (!action) return null;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        action.onClick();
                        if (!action.keepMenuOpen) setMenuOpen(false);
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
            <button
              onClick={onLogout}
              className="flex h-13 items-center border-b border-line/60 px-4 text-left text-body text-dim"
            >
              잠금 — 저장된 패스코드 지우기
            </button>
            {/* 2탭 확인(4초) — 첫 탭은 문구만 바뀌고 시트는 그대로 */}
            <button
              onClick={closeSession}
              className={`flex h-13 items-center px-4 text-left text-body font-bold ${
                confirmClose ? 'bg-coral/15 text-coral' : 'text-coral'
              }`}
            >
              {confirmClose ? '한 번 더 누르면 모임이 종료돼요' : '모임 종료'}
            </button>
          </div>
        </Sheet>
      )}
      {commandOpen && (
        <CommandSheet
          sessionId={session.id}
          live={{ attendances, games }}
          run={run}
          onClose={() => setCommandOpen(false)}
        />
      )}
      {/* 카드 [⋯] — 카드는 보드 트랙(transform) 안이라 시트를 여기(바깥)에서 띄운다 */}
      {cardMenuTarget && (
        <GameActionSheet
          game={cardMenuTarget}
          title={
            cardMenuTarget.status === 'PLAYING'
              ? `${courts.find((c) => c.id === cardMenuTarget.courtId)?.courtNo ?? ''}번 코트`
              : `다음 게임 ${queuedGames.findIndex((g) => g.id === cardMenuTarget.id) + 1}`
          }
          run={run}
          onReplace={(g) => setReplaceGameId(g.id)}
          onMoveCourt={(g) => setMoveGameId(g.id)}
          onClose={() => setCardMenuId(null)}
        />
      )}
      {actionTarget && (
        <WaitingActionSheet attendance={actionTarget} run={run} onClose={() => setActionId(null)} />
      )}
      {slotOpen && (
        <SlotFillSheet
          sessionId={session.id}
          game={slotGame}
          roster={roster}
          placeLabels={placeLabels}
          sort={rosterSort}
          onSort={setRosterSort}
          run={run}
          busy={busy}
          onCreated={(g) => setSlotTarget({ gameId: g.id, pending: g })}
          onClose={() => setSlotTarget(null)}
        />
      )}
      {replaceTarget && (
        <ReplacePlayerModal
          game={replaceTarget}
          attendances={attendances}
          sort={rosterSort}
          onSort={setRosterSort}
          run={run}
          busy={busy}
          onClose={() => setReplaceGameId(null)}
        />
      )}
      {toast && <Toast toast={toast} />}
    </main>
  );
}

// ===== 선수 교체 모달 =====

// 부상·급한 일로 게임 중/대기 조합에서 한 명만 바꾼다 — 게임을 갈아엎지 않아 타이머·큐 순서 유지
function ReplacePlayerModal({
  game,
  attendances,
  sort,
  onSort,
  run,
  busy,
  onClose,
}: {
  game: IGame;
  attendances: IAttendance[];
  sort: RosterSort; // 명단과 같은 정렬
  onSort: (sort: RosterSort) => void;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [outId, setOutId] = useState<string | null>(null);
  const [inId, setInId] = useState<string | null>(null);
  const now = useNow(); // 후보 줄의 대기 시간

  const isPlaying = game.status === 'PLAYING';
  const playerIds = new Set((game.players ?? []).map((p) => p.attendanceId));
  // 후보: 퇴장·휴식·이 게임 인원 제외. 게임 중 게임엔 다른 코트에서 뛰는 사람 투입 불가(PLAYING 동시 한 곳만)
  const candidates = sortCandidates(attendances, sort).filter(
    (a) =>
      a.status !== 'LEFT' &&
      a.status !== 'RESTING' &&
      !playerIds.has(a.id) &&
      !(isPlaying && a.status === 'PLAYING'),
  );

  const submit = () =>
    run(async () => {
      await api(`/games/${game.id}/players`, {
        method: 'PATCH',
        admin: true,
        body: { outAttendanceId: outId, inAttendanceId: inId },
      });
      onClose();
    });

  return (
    <Sheet
      ariaLabel="선수 교체"
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">선수 교체</h2>
          <p className="min-w-0 text-xs text-faint">
            {isPlaying ? '타이머는 그대로 이어져요' : '조합 순서는 그대로 유지돼요'}
          </p>
        </>
      }
    >
      <div className="min-h-0 flex-1 scroll-area">
        <h3 className="pb-1.5 text-sm font-bold text-coral">빠질 사람</h3>
        <div className="grid grid-cols-2 gap-2">
          {(game.players ?? []).map((player) => {
            const member = player.attendance?.member;
            if (!member) return null;
            return (
              <button
                key={player.attendanceId}
                onClick={() => setOutId(player.attendanceId)}
                className={`flex items-center gap-1.5 rounded-xl border p-3 text-sm ${
                  outId === player.attendanceId
                    ? 'border-coral bg-coral/10'
                    : 'border-line bg-panel2'
                }`}
              >
                <GradeBadge grade={member.grade} />
                <span className="truncate font-medium">{member.name}</span>
                <RoleCrown role={member.role} />
                <GenderMarker gender={member.gender} />
              </button>
            );
          })}
        </div>

        <div className="flex items-center pt-4 pb-1.5">
          <h3 className="text-sm font-bold text-court">들어올 사람</h3>
          <span className="ml-auto">
            <RosterSortSelect value={sort} onChange={onSort} />
          </span>
        </div>
        {candidates.length === 0 && (
          <p className="py-6 text-center text-sm text-faint">교체 투입할 수 있는 인원이 없어요</p>
        )}
        <div className="flex flex-col gap-2">
          {candidates.map((attendance) => {
            const member = attendance.member;
            if (!member) return null;
            return (
              <button
                key={attendance.id}
                onClick={() => setInId(attendance.id)}
                className={`flex items-center gap-1.5 rounded-xl border p-3 text-sm ${
                  inId === attendance.id ? 'border-court bg-court/10' : 'border-line bg-panel2'
                }`}
              >
                <GradeBadge grade={member.grade} />
                <span className="truncate font-medium">{member.name}</span>
                <RoleCrown role={member.role} />
                <GenderMarker gender={member.gender} />
                {member.isGuest && <span className="text-caption text-sky">G</span>}
                {attendance.status !== 'CHECKED_IN' && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-caption font-medium ${
                      attendance.status === 'PLAYING'
                        ? 'bg-coral/15 text-coral'
                        : 'bg-amber/15 text-amber'
                    }`}
                  >
                    {attendance.status === 'PLAYING' ? '게임 중' : '대기 조합'}
                  </span>
                )}
                {/* 대기 명단과 같은 표기 — 게임 중이면 0분 */}
                <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
                  {attendance.gamesPlayed}게임 ·{' '}
                  {attendance.status === 'PLAYING' ? '0분' : formatWaitingMinutes(attendance.waitingSince, now)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => void submit()}
        disabled={!outId || !inId || busy}
        className="mt-4 h-12 rounded-xl bg-court text-base font-bold text-bg disabled:bg-panel2 disabled:text-faint"
      >
        교체하기
      </button>
    </Sheet>
  );
}

// ===== 이스터에그 — 대기 인원 헤더 히든 존 13연타 시 모임장 응원 =====

const CHEER_TAPS = 13;
const CHEER_TAP_GAP_MS = 1000; // 이 간격 안에 이어서 눌러야 카운트 유지

// ===== 구역 공통 =====

function Zone({
  title,
  accent,
  count,
  children,
  footer,
  headerExtra,
  className = '',
}: {
  title: string;
  accent: string;
  count: number;
  children: React.ReactNode;
  footer?: React.ReactNode; // 스크롤 영역 밖 하단 고정 바 (목록이 밑으로 비치지 않음)
  headerExtra?: React.ReactNode; // 제목 오른쪽 컨트롤 (예: 게임 중 포함 토글)
  className?: string; // 컬럼 분할 시 flex-1 부여용
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-2xl bg-panel ${className}`}>
      <h2 className={`flex items-center gap-2 px-3.5 pt-3 pb-2 text-body-sm font-bold ${accent}`}>
        {title}
        <span className="tabular font-mono text-caption text-faint">{count}</span>
        {headerExtra}
      </h2>
      <div className="no-shrink flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {children}
      </div>
      {footer && <div className="flex gap-2 p-3">{footer}</div>}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center p-6 text-center text-body-sm text-faint">
      {children}
    </p>
  );
}

// ===== 게임 중 구역 =====

// 공유 코트 표시 — 다른 모임과 번갈아 쓰는 코트임을 카드 제목 옆에 알린다
function SharedBadge() {
  return (
    <span className="rounded bg-sky/15 px-1.5 py-0.5 text-caption font-medium text-sky">공유</span>
  );
}

function CourtCard({
  court,
  game,
  now,
  run,
  slotActions,
  onEnd,
  onMore,
  dragEnabled,
}: {
  court: ICourt;
  game?: IGame;
  now: number;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  slotActions: SlotActions;
  onEnd: (gameId: string, kind: 'FINISHED' | 'UNASSIGNED') => void; // 게임 종료·대기로 — 누르자마자 반영
  onMore: (game: IGame) => void; // [⋯] — 다시 알림·교체·취소 시트
  dragEnabled: boolean;
}) {
  // 게임 중인 카드의 여백에 놓으면 아무 일 없게(사람 위에 놓아야 교체) — 떼어 내기로 오인되지 않게
  const cardDrop = useDropTarget(
    `card:${game?.id ?? court.id}`,
    { kind: 'card', full: true, queued: false, ...gameRef(game) },
    dragEnabled && !!game,
  );
  // 빈 코트 — 대기 조합 카드를 손잡이로 끌어다 놓으면 배정(다른 모임 차례인 공유 코트는 제외)
  const courtDrop = useDropTarget(
    `court:${court.id}`,
    { kind: 'court', courtId: court.id },
    dragEnabled && !game && (!court.isShared || court.ourTurn),
  );
  // 공유 코트 차례 전환 — 우리→상대는 수동으로도 넘길 수 있고(양보 등), 상대→우리는 이 탭이 유일한 복귀로
  const setTurn = (ourTurn: boolean) =>
    run(() => api(`/courts/${court.id}/turn`, { method: 'PATCH', admin: true, body: { ourTurn } }), `court:${court.id}`);

  if (!game) {
    // 상대 차례인 공유 코트 — 배정이 막히는 이유가 보이게 빈 코트와 구분해 크게 표시
    if (court.isShared && !court.ourTurn) {
      return (
        <MotionCard className="rounded-xl bg-sky/8 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body font-bold text-sky">
              {court.courtNo}번 코트 <SharedBadge />
            </span>
            <span className="text-caption text-sky">다른 모임 차례</span>
          </div>
          <button
            onClick={() => void setTurn(true)}
            title="상대 게임이 끝났으면 눌러주세요 — 배정이 다시 열려요"
            className="mt-3 h-10 w-full rounded-[10px] bg-sky/15 text-body-sm font-bold text-sky"
          >
            우리 차례로
          </button>
        </MotionCard>
      );
    }
    return (
      <MotionCard
        ref={courtDrop.ref}
        className={`rounded-xl p-3 ${
          courtDrop.dragging ? 'bg-court/10 ring-[1.5px] ring-court/60 ring-inset' : 'bg-panel2/50'
        } ${courtDrop.overCls}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-body font-bold text-dim">
            {court.courtNo}번 코트 {court.isShared && <SharedBadge />}
          </span>
          <span className="text-caption text-faint">
            {courtDrop.dragging
              ? '여기에 놓으면 배정'
              : court.isShared
                ? '렛츠콕 차례 — 대기 조합에서 배정'
                : '비어 있음 — 대기 조합에서 배정'}
          </span>
        </div>
        {court.isShared && (
          <button
            onClick={() => void setTurn(false)}
            title="이번 차례를 다른 모임에 양보"
            className="mt-3 h-9 w-full rounded-lg bg-panel2 text-xs text-dim"
          >
            다른 모임 차례로 넘기기
          </button>
        )}
      </MotionCard>
    );
  }
  return (
    <MotionCard ref={cardDrop.ref} className="rounded-xl bg-panel2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-bold text-court">
          {court.courtNo}번 코트 {court.isShared && <SharedBadge />}
        </span>
        <span className="tabular font-mono text-[1.375rem] leading-none font-semibold text-court">
          {game.startedAt ? formatElapsed(game.startedAt, now) : '--:--'}
        </span>
      </div>
      <BoardSlots game={game} slotActions={slotActions} dragEnabled={dragEnabled} />
      {/* 자주 쓰는 둘만 펼치고(게임 종료·대기로) 나머지(다시 알림·교체·취소)는 [⋯] 시트 */}
      <div className="mt-3 flex gap-1.5">
        <button
          onClick={() => onEnd(game.id, 'FINISHED')}
          className="h-10 flex-1 rounded-[10px] bg-court text-body-sm font-bold text-bg"
        >
          게임 종료
        </button>
        <button
          onClick={() => onEnd(game.id, 'UNASSIGNED')}
          title="조합 유지한 채 대기 조합 맨 뒤로 (게임 수 미집계)"
          className="h-10 rounded-[10px] bg-panel px-3 text-body-sm font-medium text-amber"
        >
          대기로
        </button>
        <MoreButton label={`${court.courtNo}번 코트 더보기 — 다시 알림·교체·취소`} onClick={() => onMore(game)} />
      </div>
    </MotionCard>
  );
}

// ===== 대기 조합 구역 =====

// 놓는 곳이 속한 게임 정보(끄는 동안 못 놓을 곳을 미리 가리는 용도). 게임이 없는 빈 코트 카드는 빈 값
function gameRef(game?: IGame): GameRef {
  return {
    gameId: game?.id ?? '',
    memberIds: (game?.players ?? []).map((p) => p.attendanceId),
    playing: game?.status === 'PLAYING',
  };
}

// 4명이 다 찬 조합 — 코트 배정·모임원 앱 노출·빈 코트 채우기는 이것만(서버와 같은 기준)
function isFullGame(game: IGame): boolean {
  return (game.players?.length ?? 0) >= GAME_SIZE;
}

// 명단 순서 — 모임장 → 운영진을 맨 위에 고정(현장에서 찾기 쉽게), 그 아래는
// 비어 있는 사람 → 조합에 든 사람 → 게임 중 → 휴식 (각 묶음 안은 고른 정렬, 기본은 오래 기다린 순)
const ROLE_RANK: Record<string, number> = { LEADER: 0, MANAGER: 1 };
const roleRank = (a: IAttendance) => ROLE_RANK[a.member?.role ?? 'MEMBER'] ?? 2;
const ROSTER_RANK: Partial<Record<IAttendance['status'], number>> = {
  CHECKED_IN: 0,
  MATCHED: 1,
  PLAYING: 2,
  RESTING: 3,
};
function sortRoster(attendances: IAttendance[], sort: RosterSort): IAttendance[] {
  return sortCandidates(
    attendances.filter((a) => a.shuttleConfirmedAt && ROSTER_RANK[a.status] !== undefined),
    sort,
  );
}

// 사람 목록 정렬(명단·빈칸 채우기·선수 교체 공용) — 모임장 → 운영진 고정, 상태 묶음, 그 안에서 고른 기준(같으면 오래 기다린 순)
type RosterSort = 'WAITING' | 'NAME' | 'GRADE' | 'GAMES';
const ROSTER_SORT_LABEL: Record<RosterSort, string> = {
  WAITING: '대기순',
  NAME: '이름순',
  GRADE: '급수순',
  GAMES: '게임 적은 순',
};
const ROSTER_SORT_KEY = 'letscok:roster-sort';
function readRosterSort(): RosterSort {
  try {
    const saved = localStorage.getItem(ROSTER_SORT_KEY);
    if (saved && saved in ROSTER_SORT_LABEL) return saved as RosterSort;
  } catch {
    // 사생활 보호 모드 등 저장소를 못 쓰면 기본값
  }
  return 'WAITING';
}
const waitedLonger = (a: IAttendance, b: IAttendance) =>
  new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime();
function sortCandidates(attendances: IAttendance[], sort: RosterSort): IAttendance[] {
  const byKey = (a: IAttendance, b: IAttendance) => {
    if (sort === 'NAME') return (a.member?.name ?? '').localeCompare(b.member?.name ?? '', 'ko');
    if (sort === 'GRADE') return GRADES.indexOf(a.member?.grade ?? 'F') - GRADES.indexOf(b.member?.grade ?? 'F');
    if (sort === 'GAMES') return a.gamesPlayed - b.gamesPlayed;
    return 0;
  };
  return [...attendances].sort(
    (a, b) =>
      roleRank(a) - roleRank(b) ||
      (ROSTER_RANK[a.status] ?? 9) - (ROSTER_RANK[b.status] ?? 9) ||
      byKey(a, b) ||
      waitedLonger(a, b),
  );
}

// 정렬 고르기 — 세 목록이 같은 값을 쓴다(명단에서 본 순서가 시트에서도 같게)
function RosterSortSelect({ value, onChange }: { value: RosterSort; onChange: (sort: RosterSort) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RosterSort)}
      aria-label="정렬"
      className="h-8 shrink-0 rounded-lg bg-panel2 px-2 text-caption font-medium text-dim outline-none"
    >
      {(Object.keys(ROSTER_SORT_LABEL) as RosterSort[]).map((key) => (
        <option key={key} value={key}>
          {ROSTER_SORT_LABEL[key]}
        </option>
      ))}
    </select>
  );
}

// 사람마다 지금 있는 곳 — 대기 조합 순번들("조합 2, 3") 또는 코트("1번 코트")
function buildPlaceLabels(
  queuedGames: IGame[],
  playingByCourt: Map<string, IGame>,
  courts: ICourt[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const court of courts) {
    for (const player of playingByCourt.get(court.id)?.players ?? []) {
      labels.set(player.attendanceId, `${court.courtNo}번 코트`);
    }
  }
  const orders = new Map<string, number[]>();
  queuedGames.forEach((game, index) => {
    for (const player of game.players ?? []) {
      orders.set(player.attendanceId, [...(orders.get(player.attendanceId) ?? []), index + 1]);
    }
  });
  for (const [id, list] of orders) {
    if (!labels.has(id)) labels.set(id, `조합 ${list.join(', ')}`);
  }
  return labels;
}

// 조합·코트 카드의 4칸 — 사람 칸은 끌어다 놓기의 대상(교체), 대기 조합의 사람은 끌어서 옮기거나 떼어 낼 수 있다
// 빈칸 있는 조합: 이름 옆 ✕(빼기) + 빈칸 [+ 넣기](사람 고르기 시트, 끌어다 놓기도 됨)
function BoardSlots({
  game,
  overlapIds,
  slotActions,
  dragEnabled,
  onFillSlot,
}: {
  game: IGame;
  overlapIds?: Set<string>;
  slotActions: SlotActions;
  dragEnabled: boolean;
  onFillSlot?: () => void;
}) {
  const players = game.players ?? [];
  const queued = game.status === 'QUEUED';
  const draft = queued && !isFullGame(game);
  // 자리 바꾸기 — 길게 눌러 고른 사람(끌 수 없는 칸: 폰 전체·태블릿 게임 중 코트). 다른 사람·빈칸을 누르면 그 자리로
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (picked && !players.some((p) => p.attendanceId === picked)) setPicked(null); // 그 사람이 빠지면 선택도 푼다
  }, [players, picked]);
  const moveTo = (slot: number) => {
    const attendanceId = picked;
    setPicked(null);
    if (!attendanceId) return;
    slotActions.moveSlot(game.id, attendanceId, slot);
  };
  // 자리 순서대로 — 윗줄(자리 0·1)이 한 팀, 아랫줄(2·3)이 상대
  const cell = (slot: number) => {
    const player = players.find((p) => p.slot === slot);
    if (player?.attendance?.member) {
      const isPicked = picked === player.attendanceId;
      return (
        <SlotPerson
          key={player.id}
          game={game}
          player={player}
          overlap={overlapIds?.has(player.attendanceId) ?? false}
          removable={draft}
          onRemove={() => slotActions.removePlayer(game.id, player.attendanceId)}
          dragEnabled={dragEnabled}
          picked={isPicked}
          pickTarget={picked !== null && !isPicked}
          onLongPress={() => setPicked(player.attendanceId)}
          onTap={picked === null ? undefined : isPicked ? () => setPicked(null) : () => moveTo(slot)}
        />
      );
    }
    if (!queued) return <div key={`none-${slot}`} />;
    return (
      <EmptySlot
        key={`empty-${slot}`}
        slot={slot}
        game={game}
        dragEnabled={dragEnabled}
        pickTarget={picked !== null}
        onClick={picked !== null ? () => moveTo(slot) : onFillSlot}
      />
    );
  };
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5">
      {cell(0)}
      {cell(1)}
      <div className="col-span-2 flex h-4 items-center gap-2 text-caption font-bold text-faint" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        VS
        <span className="h-px flex-1 bg-line" />
      </div>
      {cell(2)}
      {cell(3)}
      {picked && (
        <div className="col-span-2 flex items-center gap-2 rounded-lg bg-amber/10 px-2.5 py-1.5 text-caption text-amber">
          <span className="min-w-0 flex-1">바꿀 사람이나 빈칸을 누르세요</span>
          <button onClick={() => setPicked(null)} className="tap shrink-0 font-bold">
            취소
          </button>
        </div>
      )}
      <PartnerNote people={gamePartnerPeople(game)} className="col-span-2 mt-0.5" />
    </div>
  );
}

function SlotPerson({
  game,
  player,
  overlap,
  removable,
  onRemove,
  dragEnabled,
  picked,
  pickTarget,
  onLongPress,
  onTap,
}: {
  game: IGame;
  player: NonNullable<IGame['players']>[number];
  overlap: boolean;
  removable: boolean;
  onRemove: () => void; // ✕ — 누르자마자 반영
  dragEnabled: boolean;
  picked: boolean; // 자리를 바꾸려고 길게 눌러 고른 사람
  pickTarget: boolean; // 다른 사람이 골라져 있어 이 칸을 누르면 자리가 바뀐다
  onLongPress: () => void;
  onTap?: () => void;
}) {
  const member = player.attendance!.member!;
  const queued = game.status === 'QUEUED';
  // 대기 조합에 있는데 본인은 다른 코트에서 게임 중 = 미리 짜둔 조합의 차용 인원
  const busyElsewhere = queued && player.attendance?.status === 'PLAYING';
  const drop = useDropTarget(
    `player:${game.id}:${player.attendanceId}`,
    { kind: 'player', attendanceId: player.attendanceId, ...gameRef(game) },
    dragEnabled,
  );
  // 게임 중인 코트의 사람은 끌어내지 않는다(게임을 깨지 않게 — 교체만)
  const drag = usePersonDrag(
    {
      kind: 'person',
      attendanceId: player.attendanceId,
      name: member.name,
      grade: member.grade,
      gender: member.gender,
      fromGameId: game.id,
      playing: player.attendance?.status === 'PLAYING',
    },
    dragEnabled && queued,
  );
  // 끌 수 있는 칸(태블릿 대기 조합)은 길게 누르면 끌기가 시작된다 — 자리 바꾸기는 같은 카드 안에 놓는 것으로
  const press = useLongPress(onLongPress, !(dragEnabled && queued));
  return (
    <div
      ref={mergeRefs(drop.ref, drag.ref)}
      {...drag.props}
      {...press.handlers}
      onClick={() => {
        if (press.consumeFired()) return; // 길게 누른 손을 뗄 때의 클릭은 무시
        onTap?.();
      }}
      className={`flex h-10 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg bg-panel px-2 text-sm select-none ${
        picked ? 'ring-2 ring-amber ring-inset' : pickTarget ? 'ring-1 ring-amber/40 ring-inset' : ''
      } ${drag.dragCls} ${drop.overCls}`}
      style={{ WebkitTouchCallout: 'none' }}
    >
      <GradeBadge grade={member.grade} />
      <span className="shrink-0 whitespace-nowrap font-medium">{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <span className="shrink-0 text-caption text-sky">G</span>}
      {busyElsewhere && (
        <span className="min-w-0 truncate rounded bg-coral/15 px-1 py-0.5 text-caption font-medium text-coral">게임 중</span>
      )}
      {!busyElsewhere && overlap && (
        <span
          title="다른 대기 조합에도 포함"
          className="min-w-0 truncate rounded bg-amber/15 px-1 py-0.5 text-caption font-medium text-amber"
        >
          겹침
        </span>
      )}
      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // 칸 누르기(자리 바꾸기)와 분리
            onRemove();
          }}
          aria-label={`${member.name} 빼기`}
          className="tap ml-auto h-7 w-7 shrink-0 rounded text-xs text-dim hover:text-coral"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function EmptySlot({
  slot,
  game,
  dragEnabled,
  pickTarget,
  onClick,
}: {
  slot: number;
  game: IGame;
  dragEnabled: boolean;
  pickTarget: boolean; // 자리를 바꿀 사람이 골라져 있음 — 누르면 이 자리로 옮긴다
  onClick?: () => void;
}) {
  const drop = useDropTarget(`slot:${game.id}:${slot}`, { kind: 'slot', slot, ...gameRef(game) }, dragEnabled);
  return (
    <button
      ref={drop.ref}
      onClick={onClick}
      className={`h-10 rounded-lg border border-dashed text-xs ${
        drop.dragging || pickTarget ? 'border-amber/60 text-amber' : 'border-line text-faint'
      } ${drop.overCls}`}
    >
      {drop.dragging ? '여기에 놓기' : pickTarget ? '이 자리로' : '+ 넣기'}
    </button>
  );
}

// 새 조합 자리 — 대기 조합 맨 아래에 늘 비어 있다. 눌러서 고르거나 사람을 끌어다 놓으면 빈칸 3개짜리 조합이 생긴다
function NewGameSlot({ dragEnabled, onClick }: { dragEnabled: boolean; onClick: () => void }) {
  const drop = useDropTarget('new-game', { kind: 'new-game' }, dragEnabled);
  return (
    <button
      ref={drop.ref}
      onClick={onClick}
      className={`flex h-14 shrink-0 items-center justify-center rounded-xl border border-dashed text-sm font-medium ${
        drop.dragging ? 'border-amber bg-amber/10 text-amber' : 'border-amber/40 text-amber/80'
      } ${drop.overCls}`}
    >
      {drop.dragging ? '여기에 놓으면 새 조합' : '+ 새 조합'}
    </button>
  );
}

// 명단 구역 — 조합 카드에서 끌어낸 사람을 여기 놓으면 그 조합에서 빠진다(자석 떼기)
function RosterDrop({
  className,
  dragEnabled,
  children,
}: {
  className: string;
  dragEnabled: boolean;
  children: React.ReactNode;
}) {
  const drop = useDropTarget('roster', { kind: 'roster' }, dragEnabled);
  return (
    <div ref={drop.ref} className={`${className} rounded-2xl ${drop.overCls}`}>
      {children}
    </div>
  );
}

// 빈칸 채우기 시트 — 명단에서 한 명씩 눌러 넣는다. game=null이면 첫 사람으로 새 조합을 만들고 그 조합을 이어서 채운다
// 4명이 차면 부모가 저절로 닫는다(실시간 스냅샷 기준)
function SlotFillSheet({
  sessionId,
  game,
  roster,
  placeLabels,
  sort,
  onSort,
  run,
  busy,
  onCreated,
  onClose,
}: {
  sessionId: string;
  game: IGame | null;
  roster: IAttendance[]; // 이미 고른 정렬로 정렬된 명단
  placeLabels: Map<string, string>;
  sort: RosterSort;
  onSort: (sort: RosterSort) => void;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
  onCreated: (game: IGame) => void;
  onClose: () => void;
}) {
  const inGame = new Set((game?.players ?? []).map((p) => p.attendanceId));
  const candidates = roster.filter((a) => a.status !== 'RESTING' && !inGame.has(a.id));
  const now = useNow(); // 후보 줄의 대기 시간
  const empty = GAME_SIZE - inGame.size;

  const pick = (attendanceId: string) =>
    void run(async () => {
      if (game) {
        await api(`/games/${game.id}/players`, { method: 'POST', admin: true, body: { attendanceId } });
      } else {
        onCreated(
          await api<IGame>(`/sessions/${sessionId}/games/draft`, {
            method: 'POST',
            admin: true,
            body: { attendanceId },
          }),
        );
      }
    });

  return (
    <Sheet
      ariaLabel="조합에 넣기"
      onClose={onClose}
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-amber">조합에 넣기</h2>
          <p className="min-w-0 text-xs text-faint">빈칸 {empty}개 · 누르면 바로 들어가요</p>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-dim">
          {game && <>지금: {(game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean).join(', ')}</>}
        </p>
        <RosterSortSelect value={sort} onChange={onSort} />
      </div>
      {candidates.length === 0 && <p className="py-6 text-center text-sm text-faint">넣을 수 있는 사람이 없어요</p>}
      {candidates.map((attendance) => {
        const member = attendance.member;
        if (!member) return null;
        const place = placeLabels.get(attendance.id);
        return (
          <button
            key={attendance.id}
            onClick={() => pick(attendance.id)}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-panel2 p-3 text-left text-sm disabled:opacity-50"
          >
            <GradeBadge grade={member.grade} />
            <span className="shrink-0 whitespace-nowrap font-medium">{member.name}</span>
            <RoleCrown role={member.role} />
            <GenderMarker gender={member.gender} />
            {member.isGuest && <span className="shrink-0 text-caption text-sky">G</span>}
            {place && (
              <span
                className={`min-w-0 truncate rounded px-1.5 py-0.5 text-caption font-medium ${
                  attendance.status === 'PLAYING' ? 'bg-coral/15 text-coral' : 'bg-amber/15 text-amber'
                }`}
              >
                {place}
              </span>
            )}
            {/* 대기 명단과 같은 표기 — 게임 중이면 0분 */}
            <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
              {attendance.gamesPlayed}게임 ·{' '}
              {attendance.status === 'PLAYING' ? '0분' : formatWaitingMinutes(attendance.waitingSince, now)}
            </span>
          </button>
        );
      })}
    </Sheet>
  );
}

function QueueCard({
  game,
  order,
  neighborUp,
  neighborDown,
  idleCourts,
  overlapIds,
  run,
  slotActions,
  onMore,
  onPickCourt,
  onAssign,
  onMove,
  onFillSlot,
  onRecommend,
  dragEnabled,
}: {
  game: IGame;
  order: number;
  neighborUp?: IGame;
  neighborDown?: IGame;
  idleCourts: ICourt[];
  overlapIds: Set<string>;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  slotActions: SlotActions;
  onMore: (game: IGame) => void; // [⋯] — 교체·해체 시트(4명 조합)
  onPickCourt: (game: IGame) => void; // 빈 코트가 여럿이면 코트 고르기 시트
  onAssign: (gameId: string, courtId: string) => void; // 빈 코트가 하나면 바로 배정
  onMove: (gameId: string, delta: -1 | 1) => void; // ▲▼ 순서 — 누르자마자 반영
  onFillSlot: (game: IGame) => void; // 빈칸 → 사람 고르기 시트
  onRecommend: (game: IGame) => void; // 짜는 중 조합 → 빈자리 추천
  dragEnabled: boolean;
}) {
  const full = isFullGame(game);
  // 사람 놓기(태블릿)·조합 순서 놓기(폰 포함) 둘 다 받는다 — 무엇을 받을지는 board-dnd가 끄는 것에 따라 가린다
  const cardDrop = useDropTarget(`card:${game.id}`, { kind: 'card', full, queued: true, ...gameRef(game) }, true);
  // 손잡이로 이 조합을 끌어 다른 조합 위(순서)·빈 코트(배정, 태블릿)에 놓는다 — 폰도 같은 구역 안 순서 바꾸기는 된다
  const gameDrag = useGameDrag(
    {
      kind: 'game',
      gameId: game.id,
      order,
      names: (game.players ?? []).map((p) => p.attendance?.member?.name ?? '').filter(Boolean),
      full,
      blocked: (game.players ?? []).some((p) => p.attendance?.status === 'PLAYING'),
    },
    true,
  );
  // 바로 배정할 수 있는 코트(상대 차례인 공유 코트 제외) — 하나뿐이면 시트 없이 한 번에 넣는다
  const available = idleCourts.filter((court) => !court.isShared || court.ourTurn);

  // 미리 짜둔 조합엔 아직 게임 중인 인원이 있을 수 있다 — 전원이 자유로워질 때까지 배정 불가
  const busyNames = (game.players ?? [])
    .filter((player) => player.attendance?.status === 'PLAYING')
    .map((player) => player.attendance?.member?.name)
    .filter(Boolean);

  return (
    <MotionCard
      ref={cardDrop.ref}
      className={`rounded-xl p-3 ${full ? 'bg-panel2' : 'border-[1.5px] border-dashed border-amber/50'} ${
        cardDrop.overCls
      } ${gameDrag.isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-bold text-amber">
          <span
            ref={gameDrag.ref}
            {...gameDrag.props}
            aria-label={`다음 게임 ${order} 옮기기 — 길게 눌러 끌기`}
            title="끌어서 순서 바꾸기·빈 코트에 놓아 배정"
            className="tap -ml-1 flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-base text-faint select-none"
          >
            ⠿
          </span>
          <span className="text-body-sm">다음 게임 {order}</span>
          {!full && <span className="ml-1.5 text-caption font-medium text-faint">짜는 중</span>}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => onMove(game.id, -1)}
            disabled={!neighborUp}
            aria-label="위로"
            className="tap h-8 w-8 rounded-lg bg-panel text-dim disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(game.id, 1)}
            disabled={!neighborDown}
            aria-label="아래로"
            className="tap h-8 w-8 rounded-lg bg-panel text-dim disabled:opacity-30"
          >
            ▼
          </button>
        </div>
      </div>
      <BoardSlots
        game={game}
        overlapIds={overlapIds}
        slotActions={slotActions}
        dragEnabled={dragEnabled}
        onFillSlot={() => onFillSlot(game)}
      />
      {/* 4명 조합: 배정 + [⋯](교체·해체) / 빈칸 조합: 할 일이 해체뿐이라 바로 둔다 */}
      <div className="mt-3 flex gap-1.5">
        {!full ? (
          <button
            onClick={() => onRecommend(game)}
            className="h-10 flex-1 rounded-[10px] bg-court/10 px-2 text-body-sm font-bold text-court"
          >
            빈자리 {GAME_SIZE - (game.players?.length ?? 0)}명 추천
          </button>
        ) : busyNames.length > 0 ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-[10px] bg-panel px-2 text-center text-caption text-faint">
            {busyNames.join(', ')} 게임 종료 후 배정 가능
          </span>
        ) : available.length === 0 ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-[10px] bg-panel px-2 text-center text-caption text-faint">
            빈 코트가 없어요
          </span>
        ) : available.length === 1 ? (
          <button
            onClick={() => onAssign(game.id, available[0].id)}
            className="h-10 flex-1 rounded-[10px] bg-amber text-body-sm font-bold text-bg"
          >
            {available[0].courtNo}번 코트로 배정
          </button>
        ) : (
          <button
            onClick={() => onPickCourt(game)}
            className="h-10 flex-1 rounded-[10px] bg-amber text-body-sm font-bold text-bg"
          >
            코트 배정
          </button>
        )}
        {full ? (
          <MoreButton label={`다음 게임 ${order} 더보기 — 교체·해체`} onClick={() => onMore(game)} />
        ) : (
          <ConfirmButton
            label="해체"
            confirmLabel="정말 해체"
            title="이 조합을 없애고 든 사람을 대기로 돌려보내요"
            onConfirm={() => void run(() => api(`/games/${game.id}/cancel`, { method: 'PATCH', admin: true }), `game:${game.id}`)}
            className="h-10 rounded-[10px] px-3 text-body-sm"
            idleCls="text-coral"
          />
        )}
      </div>
    </MotionCard>
  );
}

// ===== 대기 인원 구역 =====

// 콕 확인 대기 행 — [콕 확인] 버튼만 누른다 (행 전체를 버튼으로 두면 스크롤하다 스친 행이 확인돼 버린다)
// 확인 전에는 게임 배정이 막히므로 선택 체크박스는 없다
function ShuttleRow({
  attendance,
  run,
  onConfirm,
}: {
  attendance: IAttendance;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  onConfirm: (attendanceId: string) => void; // 누르자마자 명단으로(잠금 없이 — 연달아 눌러도 모두 처리)
}) {
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard className="flex min-h-11 items-center gap-2 rounded-[10px] bg-amber/10 py-1.5 pr-1.5 pl-2.5 text-body-sm transition-colors">
      <GradeBadge grade={member.grade} />
      <RoleCrown role={member.role} />
      <span className="shrink-0 whitespace-nowrap font-medium">{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <GuestMark />}
      {/* 사전 체크인 취소 — 개인 사정·노쇼 등으로 못 오게 된 사람을 출석 기록 없이 제거 (퇴장과 다름) */}
      {/* 출석 취소(노쇼) 2탭 확인 — 콕 확인 바로 옆이라 오탭 한 번에 지워지면 안 된다 */}
      <ConfirmButton
        label="취소"
        title="출석 취소 — 못 오게 된 사람을 출석 기록 없이 제거"
        onConfirm={() => void run(() => api(`/attendances/${attendance.id}`, { method: 'DELETE', admin: true }))}
        className="tap ml-auto h-8 shrink-0 rounded-lg px-2.5 text-caption font-medium"
        idleCls="text-dim"
      />
      <button
        onClick={() => onConfirm(attendance.id)}
        className="h-8 shrink-0 rounded-lg bg-amber px-3 text-caption font-bold text-bg"
      >
        콕 확인
      </button>
    </MotionCard>
  );
}

// 되돌리기 어려운 동작의 2탭 확인 버튼 — 첫 탭은 빨갛게 "한 번 더"로 바뀌기만 하고, 3초 안에 다시 눌러야 실행된다
// (행 안에 있는 버튼이 많아 행 선택 토글로 번지지 않게 항상 stopPropagation)
function ConfirmButton({
  label,
  confirmLabel = '한 번 더',
  title,
  className,
  idleCls,
  onConfirm,
}: {
  label: React.ReactNode;
  confirmLabel?: string;
  title?: string;
  className: string; // 크기·모양만 — 색은 상태별로 갈린다
  idleCls: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (timer.current) clearTimeout(timer.current);
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000); // 눌러둔 채 잊는 실수 방지
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      title={title}
      className={`${className} ${armed ? 'border border-coral bg-coral/15 font-bold text-coral' : idleCls}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// 운영진 호출·코트 다시 알림 공용 버튼 — 결과를 버튼 자리에 3초 보여준다
// (보드 토스트는 에러 전용 색이라, "몇 대에 보냈는지 / 알림 미등록"은 버튼 안에서 바로 확인)
function CallButton({
  path,
  label,
  title,
  className,
  idleCls,
}: {
  path: string;
  label: React.ReactNode; // 글자 또는 아이콘 + 글자
  title: string;
  className: string; // 크기·테두리만 — 글자색은 상태별로 갈리므로 idleCls로 따로 받는다
  idleCls: string;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; cls: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = (text: string, cls: string) => {
    setFeedback({ text, cls });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 3000);
  };

  const call = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 대기 행 선택 토글과 분리
    if (busy) return;
    setBusy(true);
    try {
      const { devices } = await api<IPushCallResult>(path, { method: 'POST', admin: true });
      // 0대 = 알림을 등록하지 않은 사람 — 직접 불러야 한다
      if (devices > 0) show(`${devices}대 전송`, 'text-court');
      else show('알림 미등록', 'text-amber');
    } catch (err) {
      show(err instanceof ApiError && err.status === 429 ? '잠시 후' : '실패', 'text-coral');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={(e) => void call(e)}
      disabled={busy}
      title={feedback?.text === '알림 미등록' ? '알림을 등록하지 않은 분이에요 — 직접 불러주세요' : title}
      className={`${className} disabled:opacity-50 ${feedback?.cls ?? idleCls}`}
    >
      {feedback?.text ?? label}
    </button>
  );
}

function WaitingRow({
  attendance,
  now,
  selected,
  onToggle,
  run,
  busyStatus,
  placeLabel,
  resting,
  onMore,
  dragEnabled,
  partnerName,
}: {
  attendance: IAttendance;
  now: number;
  selected: boolean;
  onToggle: () => void;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  onMore: (attendance: IAttendance) => void; // 폰: 줄 버튼 대신 [⋯] → 동작 시트
  busyStatus?: 'PLAYING' | 'MATCHED'; // 조합·게임에 든 사람 — 흐리게 + 위치 칩, 휴식·퇴장 버튼 없음
  placeLabel?: string; // 위치 칩 문구("조합 2, 3"·"1번 코트")
  resting?: boolean; // 휴식 행 — 선택 불가, 복귀·퇴장 버튼만
  dragEnabled: boolean; // 태블릿: 살짝 길게 눌러(마우스는 끌어) 조합 칸으로 옮긴다
  partnerName?: string; // 대회 연습 파트너 — 눌러서(두 번) 해제
}) {
  const member = attendance.member;
  const drag = usePersonDrag(
    {
      kind: 'person',
      attendanceId: attendance.id,
      name: member?.name ?? '',
      grade: member?.grade ?? 'C',
      gender: member?.gender ?? null,
      fromGameId: null,
      playing: attendance.status === 'PLAYING',
    },
    dragEnabled && !resting && !!member,
  );
  if (!member) return null;
  return (
    <MotionCard
      ref={drag.ref}
      {...drag.props}
      onClick={resting ? undefined : onToggle}
      className={`flex min-h-11 items-center gap-2 rounded-[10px] py-1.5 pr-1.5 pl-2.5 text-body-sm transition-colors ${
        selected ? 'bg-amber/12 ring-[1.5px] ring-amber ring-inset' : 'bg-panel2'
      } ${(busyStatus && !selected) || resting ? 'opacity-60' : ''} ${
        resting ? '' : 'cursor-pointer'
      } ${drag.dragCls}`}
    >
      <GradeBadge grade={member.grade} />
      <RoleCrown role={member.role} />
      {/* 이름은 줄이지 않는다(폰에서 "김…"이 되던 문제) — 공간이 모자라면 옆 칩이 대신 줄어든다 */}
      <span className={`shrink-0 whitespace-nowrap ${selected ? 'font-bold' : 'font-medium'}`}>{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <GuestMark />}
      {busyStatus && (
        <span
          className={`min-w-0 truncate rounded-md px-1.5 py-0.5 text-caption font-medium ${
            busyStatus === 'PLAYING' ? 'bg-coral/15 text-coral' : 'bg-amber/15 text-amber'
          }`}
        >
          {placeLabel ?? (busyStatus === 'PLAYING' ? '게임 중' : '대기 조합')}
        </span>
      )}
      {resting && (
        <span className="min-w-0 truncate rounded-md bg-sky/15 px-1.5 py-0.5 text-caption font-medium text-sky">
          휴식
        </span>
      )}
      {partnerName && (
        <ConfirmButton
          label={`파트너 ${partnerName}`}
          confirmLabel="파트너 해제"
          title={`대회 연습 파트너: ${partnerName} — 두 번 누르면 해제`}
          onConfirm={() => void run(() => api(`/attendances/${attendance.id}/partner`, { method: 'DELETE', admin: true }))}
          className="tap h-6 min-w-0 shrink truncate rounded-md px-1.5 text-caption font-medium"
          idleCls="bg-sky/15 text-sky"
        />
      )}
      <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
        {/* 게임 중엔 기다리는 게 아니라 0분 — 대기 시간은 게임이 끝나면 다시 센다(대기 조합은 아직 기다리는 중이라 그대로) */}
        {attendance.gamesPlayed}게임 · {attendance.status === 'PLAYING' ? '0분' : formatWaitingMinutes(attendance.waitingSince, now)}
      </span>
      {/* 호출·휴식/복귀·콕 확인 취소·퇴장은 [⋯] 하나로 모으고 시트에서 고른다(폰·태블릿 공통) — 작은 버튼이 줄에 붙으면 잘못 누르기 쉽다 */}
      <button
        onClick={(e) => {
          e.stopPropagation(); // 행 선택 토글과 분리
          onMore(attendance);
        }}
        aria-label={`${member.name} 동작 더보기`}
        className="tap h-8 w-8 shrink-0 rounded-lg text-lg leading-none text-dim"
      >
        ⋯
      </button>
    </MotionCard>
  );
}

// 길게 누르기(약 0.45초) — 손가락이 움직이면 취소(스크롤·구역 넘기기와 구분). 뗄 때 오는 클릭은 consumeFired로 걸러 낸다
function useLongPress(onLongPress: () => void, enabled: boolean, ms = 450) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const handlers = enabled
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          fired.current = false;
          start.current = { x: e.clientX, y: e.clientY };
          cancel();
          timer.current = window.setTimeout(() => {
            fired.current = true;
            navigator.vibrate?.(15);
            onLongPress();
          }, ms);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // 안드로이드 길게 누르기 메뉴 막기
      }
    : {};
  const consumeFired = () => {
    const was = fired.current;
    fired.current = false;
    return was;
  };
  return { handlers, consumeFired };
}

// 모임장(주황)·운영진(초록) 왕관 — 글자 칩보다 자리를 덜 차지한다
function RoleCrown({ role }: { role: MemberRole }) {
  if (role === 'MEMBER') return null;
  const label = role === 'LEADER' ? '모임장' : '운영진';
  return (
    <span title={label} className={`flex shrink-0 ${role === 'LEADER' ? 'text-amber' : 'text-court'}`}>
      <CrownIcon size={14} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// 게스트 표시 — 폰에선 "G"로 짧게(이름 자리를 지키려고), 넓은 화면에선 "게스트"
function GuestMark() {
  return (
    <span className="shrink-0 text-caption text-sky">
      <span className="sm:hidden">G</span>
      <span className="hidden sm:inline">게스트</span>
    </span>
  );
}

// 카드의 [⋯] — 자주 안 쓰는 동작을 시트로 모은다
function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-panel text-lg leading-none text-dim"
    >
      ⋯
    </button>
  );
}

// 코트·조합 카드 [⋯] 시트 — 게임 중: 다시 알림·교체·게임 취소 / 대기 조합: 교체·해체
function GameActionSheet({
  game,
  title,
  run,
  onReplace,
  onMoveCourt,
  onClose,
}: {
  game: IGame;
  title: string;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  onReplace: (game: IGame) => void;
  onMoveCourt: (game: IGame) => void;
  onClose: () => void;
}) {
  const playing = game.status === 'PLAYING';
  const names = (game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean).join(', ');
  const cancel = () =>
    void run(async () => {
      await api(`/games/${game.id}/cancel`, { method: 'PATCH', admin: true });
      onClose();
    }, `game:${game.id}`);
  const row = 'h-12 w-full rounded-xl px-4 text-left text-body-sm font-medium';
  return (
    <Sheet
      ariaLabel={`${title} 동작`}
      onClose={onClose}
      header={
        <div className="flex min-w-0 flex-col">
          <h2 className={`text-heading font-bold ${playing ? 'text-court' : 'text-amber'}`}>{title}</h2>
          <p className="truncate text-caption text-dim">{names}</p>
        </div>
      }
      bodyClassName="flex flex-col gap-2 pb-1"
    >
      {playing && (
        <CallButton
          path={`/games/${game.id}/renotify`}
          label="다시 알림 — 4명에게 코트 알림 다시 보내기"
          title="배정됐는데 안 오는 사람이 있을 때"
          className={`${row} bg-panel2`}
          idleCls="text-ink"
        />
      )}
      <button
        onClick={() => {
          onReplace(game);
          onClose();
        }}
        className={`${row} bg-panel2 text-ink`}
      >
        {playing ? '교체 — 한 명만 바꾸기(타이머 유지)' : '교체 — 한 명만 바꾸기(순서 유지)'}
      </button>
      {playing && (
        <button
          onClick={() => {
            onMoveCourt(game);
            onClose();
          }}
          className={`${row} bg-panel2 text-ink`}
        >
          다른 코트로 옮기기 — 빈 코트로(타이머 유지)
        </button>
      )}
      <ConfirmButton
        label={playing ? '게임 취소 — 조합까지 해체(게임 수 안 셈)' : '해체 — 조합을 없애고 대기로'}
        confirmLabel={playing ? '한 번 더 누르면 게임 취소' : '한 번 더 누르면 해체'}
        onConfirm={cancel}
        className={row}
        idleCls="bg-coral/10 text-coral"
      />
    </Sheet>
  );
}

// 폰 대기 줄 [⋯] 시트 — 호출·휴식/복귀·콕 확인 취소·퇴장을 큰 버튼으로. 상태에 맞는 것만 보인다
function WaitingActionSheet({
  attendance,
  run,
  onClose,
}: {
  attendance: IAttendance;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  onClose: () => void;
}) {
  const member = attendance.member;
  const resting = attendance.status === 'RESTING';
  const busy = attendance.status === 'PLAYING' || attendance.status === 'MATCHED'; // 게임 중·조합에 든 사람은 호출만
  const act = (path: string, admin: boolean) =>
    void run(async () => {
      await api(`/attendances/${attendance.id}/${path}`, { method: 'PATCH', ...(admin && { admin: true }) });
      onClose();
    }, `attendance:${attendance.id}`);
  const row = 'h-12 w-full rounded-xl px-4 text-left text-sm font-medium';
  return (
    <Sheet
      ariaLabel={`${member?.name ?? ''} 동작`}
      onClose={onClose}
      header={
        <>
          {member && <GradeBadge grade={member.grade} />}
          <h2 className="min-w-0 truncate text-lg font-bold">{member?.name}</h2>
          <span className="shrink-0 font-mono text-xs text-dim">{attendance.gamesPlayed}게임</span>
        </>
      }
      bodyClassName="flex flex-col gap-2 pb-1"
    >
      <CallButton
        path={`/attendances/${attendance.id}/call`}
        label={
          <span className="flex items-center gap-2">
            <MegaphoneIcon /> 호출 — 폰으로 &lsquo;운영진이 찾고 있어요&rsquo; 알림
          </span>
        }
        title="이 분 폰으로 알림을 보내요"
        className={`${row} bg-panel2`}
        idleCls="text-ink"
      />
      {resting && (
        <button onClick={() => act('resume', false)} className={`${row} bg-sky/10 text-sky`}>
          복귀 — 대기로 돌아가기(대기 시간 이어서)
        </button>
      )}
      {!busy && !resting && (
        <button onClick={() => act('rest', false)} className={`${row} bg-panel2 text-ink`}>
          휴식 — 게임 조합에서 잠깐 빼기
        </button>
      )}
      {!busy && (
        <ConfirmButton
          label="콕 확인 취소 — 콕 확인 대기로 되돌리기"
          confirmLabel="한 번 더 누르면 콕 확인 취소"
          onConfirm={() => act('shuttle/cancel', true)}
          className={row}
          idleCls="bg-panel2 text-amber"
        />
      )}
      {!busy && (
        <ConfirmButton
          label="퇴장"
          confirmLabel="한 번 더 누르면 퇴장"
          onConfirm={() => act('leave', true)}
          className={row}
          idleCls="bg-coral/10 text-coral"
        />
      )}
    </Sheet>
  );
}
