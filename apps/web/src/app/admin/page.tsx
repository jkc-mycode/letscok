'use client';

import {
  GAME_SIZE,
  Gender,
  Grade,
  IAttendance,
  ICheckInCodeResponse,
  ICourt,
  IFillCourtsResult,
  IGame,
  IAdminMemo,
  IHistorySessionDetail,
  IGameRecommendation,
  IMember,
  IMemberAlias,
  IMemberPage,
  IMemberSummary,
  IPushCallResult,
  ISessionSnapshot,
  MemberListFilter,
  MemberListSort,
  MemberRole,
  RecommendationCategory,
  RecommendationKind,
} from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { LoginGate, useAdminAuth } from '@/components/admin-gate';
import { AiCheckInPanel } from '@/components/ai-check-in-panel';
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
import { SettlementModal } from '@/components/settlement-modal';
import { Sheet } from '@/components/sheet';
import { ThemeToggle } from '@/components/theme-toggle';
import { ExitGuard } from '@/components/exit-guard';
import { ClearableInput } from '@/components/clearable-input';
import { gamePartnerPeople, GenderMarker, GradeBadge, PartnerNote, Toast } from '@/components/badges';
import { HomeLink } from '@/components/home-link';
import { InstallPrompt } from '@/components/install-prompt';
import { CrownIcon, MegaphoneIcon } from '@/components/icons';
import { LogoLoader } from '@/components/logo-loader';
import { MotionCard } from '@/components/motion-card';
import { GRADES, MultiMemberForm, NewMemberBody } from '@/components/multi-member-form';
import { api, ApiError } from '@/lib/api';
import { formatBirthInput, parseBirthDate } from '@/lib/birth-input';
import {
  formatElapsed,
  formatWaitingMinutes,
  useNow,
  useSnapshot,
} from '@/lib/use-snapshot';
import { ToastState, useToast } from '@/lib/use-toast';

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
  const { toast, showToast } = useToast();
  const [busy, setBusy] = useState(false);
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

  // 모든 변경 액션의 공통 실행기 — 실패 시 서버의 한국어 메시지를 토스트로
  // 성공 시 refetch: 소켓 룸 입장 전(세션 시작 직후)이나 연결 끊김 중에도 화면이 따라오게
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
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
        busy={busy}
        toast={toast}
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
  run: (a: () => Promise<unknown>) => Promise<void>;
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
  { title: '모임 중', keys: ['code', 'log', 'courts'] },
  { title: '관리', keys: ['members', 'history', 'birthday', 'settlement', 'help'] },
];

// 폰 전용 구역 탭 — md 이상에서는 전부 동시에 보이므로 무시된다
type MobileTab = 'courts' | 'queue' | 'waiting' | 'memo';

const SWIPE_LOCK_PX = 8; // 이만큼 움직인 뒤 가로·세로 중 큰 쪽으로 방향을 정한다
const SWIPE_COMMIT_PX = 70; // 손을 뗐을 때 이 이상(또는 화면 폭 25% 이상) 밀었으면 옆 탭으로
const SWIPE_EDGE_GUARD = 20; // 화면 가장자리 시작 스와이프는 시스템 제스처에 양보

function BoardBody({
  snapshot,
  run,
  busy,
  toast,
  onLogout,
  onSessionClosed,
}: {
  snapshot: ISessionSnapshot;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  toast: ToastState | null;
  onLogout: () => void;
  onSessionClosed: (sessionId: string) => void; // 모임 종료 성공 → 마무리 문구 띄우기
}) {
  const router = useRouter();
  const now = useNow();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false); // 운영진 수동 체크인 (사전 등록·현장 대리 등 예외용)
  const [membersOpen, setMembersOpen] = useState(false); // 모임원 관리 (명단 조회·수정·정리)
  const [birthdayOpen, setBirthdayOpen] = useState(false); // 생일 캘린더
  const [settlementOpen, setSettlementOpen] = useState(false); // 뒤풀이 정산

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
  const [commandOpen, setCommandOpen] = useState(false); // AI 명령(글·음성)
  // 빈칸 채우기 시트 — gameId=null이면 새 조합(첫 사람을 고르면 그 조합으로 이어서 채운다)
  // pending = 방금 만든 조합(실시간 화면이 도착하기 전까지 대신 보여 줘서 시트가 깜빡 닫히지 않게)
  const [slotTarget, setSlotTarget] = useState<{ gameId: string | null; pending?: IGame } | null>(null);

  const { session, courts, attendances, games } = snapshot;
  const dragEnabled = useBoardDragEnabled(); // 태블릿 이상 — 자석판처럼 끌어다 놓기


  const playingByCourt = useMemo(() => {
    const map = new Map<string, IGame>();
    for (const game of games) {
      if (game.status === 'PLAYING' && game.courtId) map.set(game.courtId, game);
    }
    return map;
  }, [games]);
  // 끌어서 바꾼 순서 — 다음 실시간 화면이 오면 버린다(그때는 서버 순서가 같아져 있다)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  useEffect(() => setPendingOrder(null), [games]);
  const queuedGames = useMemo(() => {
    const list = games.filter((g) => g.status === 'QUEUED');
    if (!pendingOrder) return list;
    const rank = new Map(pendingOrder.map((id, index) => [id, index]));
    return [...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }, [games, pendingOrder]);

  // 끌어다 놓기 → 서버 호출. 카드에서 끌어낸 사람은 자석을 옮기듯 원래 조합에서 빠진다
  const onDrop = useCallback(
    (item: DragItem, target: DropTarget | null) => {
      if (item.kind === 'game') {
        if (target?.kind === 'court') {
          void run(() => api(`/games/${item.gameId}/assign`, { method: 'PATCH', admin: true, body: { courtId: target.courtId } }));
          return;
        }
        if (target?.kind !== 'card') return;
        // 놓은 카드 자리로 — 그 카드와 사이의 조합들이 한 칸씩 밀린다
        const ids = queuedGames.map((g) => g.id);
        const from = ids.indexOf(item.gameId);
        const to = ids.indexOf(target.gameId);
        if (from < 0 || to < 0 || from === to) return;
        const next = arrayMove(ids, from, to);
        setPendingOrder(next); // 서버 응답·실시간 화면을 기다리지 않고 바로 그 순서로 보여 준다
        void run(async () => {
          try {
            await api(`/sessions/${session.id}/games/order`, { method: 'PATCH', admin: true, body: { gameIds: next } });
          } catch (error) {
            setPendingOrder(null);
            throw error;
          }
        });
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
        if (from) void run(leaveOrigin);
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
        void run(() => api(`/games/${from}/slots`, { method: 'PATCH', admin: true, body: { attendanceId: person.attendanceId, slot } }));
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
    [run, session.id, queuedGames],
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
    });

  // 콕 확인 대기 — 확인 전엔 게임 배정이 막히므로 대기 인원과 분리해 구역 맨 위에 모은다
  // (운영진은 이 섹션이 비었는지만 확인하면 된다)
  const pendingShuttle = useMemo(
    () => attendances.filter((a) => a.status !== 'LEFT' && !a.shuttleConfirmedAt),
    [attendances],
  );
  // 명단 — 콕 확인된 출석자 전원(조합에 넣어도 사라지지 않는 자석판 명단). 비어 있는 사람(오래 기다린 순)이 위
  const roster = useMemo(() => sortRoster(attendances), [attendances]);
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
  const createGame = () =>
    run(async () => {
      const ids = [...selected];
      if (ids.length === GAME_SIZE) {
        await api(`/sessions/${session.id}/games`, {
          method: 'POST',
          admin: true,
          body: { attendanceIds: ids },
        });
      } else {
        const draft = await api<IGame>(`/sessions/${session.id}/games/draft`, {
          method: 'POST',
          admin: true,
          body: { attendanceId: ids[0] },
        });
        for (const attendanceId of ids.slice(1)) {
          await api(`/games/${draft.id}/players`, { method: 'POST', admin: true, body: { attendanceId } });
        }
      }
      setSelected(new Set());
    });

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
                onMore={(g) => setCardMenuId(g.id)}
                onPickCourt={(g) => setAssignGameId(g.id)}
                onFillSlot={(g) => setSlotTarget({ gameId: g.id })}
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
                onClick={() => void createGame()}
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
              <p className="pb-1 text-center text-caption font-medium text-amber">
                콕 확인 대기 {pendingShuttle.length}명 — [콕 확인]을 누르면 명단으로 내려가요
              </p>
              <AnimatePresence initial={false}>
                {pendingShuttle.map((attendance) => (
                  <ShuttleRow key={attendance.id} attendance={attendance} run={run} />
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
      {codeOpen && <CheckInCodeModal onClose={() => setCodeOpen(false)} />}
      {membersOpen && <MembersManagerModal onClose={() => setMembersOpen(false)} />}
      {birthdayOpen && <BirthdayCalendarModal onClose={() => setBirthdayOpen(false)} />}
      {settlementOpen && <SettlementModal onClose={() => setSettlementOpen(false)} />}
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
          run={run}
          onClose={() => setCourtsOpen(false)}
        />
      )}
      {/* 코트 고르기 — 대기 조합 카드는 보드 트랙(transform) 안이라 시트를 여기(바깥)에서 띄운다 */}
      {assignTarget && (
        <CourtPickSheet
          game={assignTarget}
          idleCourts={idleCourts}
          run={run}
          onClose={() => setAssignGameId(null)}
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
          run={run}
          busy={busy}
          onClose={() => setReplaceGameId(null)}
        />
      )}
      {toast && <Toast toast={toast} />}
    </main>
  );
}

// ===== 게임 추천 모달 =====

// 후보 성격별 표시 — 서버의 RecommendationKind와 1:1
const KIND_META: Record<
  RecommendationKind,
  { label: string; desc: string; text: string; border: string }
> = {
  FAIRNESS: { label: '공정성', desc: '오래 기다린 사람부터', text: 'text-court', border: 'border-court/40' },
  FRESH: { label: '새 조합', desc: '오늘 안 만난 사람 위주', text: 'text-sky', border: 'border-sky/40' },
  MIX: { label: '믹스', desc: '상위 조합에서 살짝 섞음', text: 'text-amber', border: 'border-amber/40' },
};

// 종목 탭 — 서버 category 필터와 1:1. ALL이 기본(기존 동작)
const CATEGORY_TABS: { value: RecommendationCategory; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'MENS', label: '남복' },
  { value: 'WOMENS', label: '여복' },
  { value: 'MIXED', label: '혼복' },
  { value: 'OTHER', label: '기타 3:1' },
];

// 탭별 빈 결과 사유 — 스냅샷 출석 성별을 세어 구체적으로 안내 (추가 API 없음)
function emptyMessage(category: RecommendationCategory, attendances: IAttendance[]): string {
  const active = attendances.filter((a) => a.status !== 'LEFT' && a.status !== 'RESTING'); // 휴식은 추천 풀 밖
  const m = active.filter((a) => a.member?.gender === 'MALE').length;
  const f = active.filter((a) => a.member?.gender === 'FEMALE').length;
  if (category === 'MENS' && m < 4) return `남성 인원이 ${m}명이라 남복 조합을 만들 수 없어요`;
  if (category === 'WOMENS' && f < 4) return `여성 인원이 ${f}명이라 여복 조합을 만들 수 없어요`;
  if (category === 'MIXED' && (m < 2 || f < 2))
    return `혼복은 남녀 2명씩 필요해요 (현재 남 ${m} · 여 ${f})`;
  if (category === 'OTHER' && !((m >= 3 && f >= 1) || (m >= 1 && f >= 3)))
    return `3:1 구성이 안 나오는 인원이에요 (현재 남 ${m} · 여 ${f})`;
  // 성별 인원은 충분한데 후보가 없는 경우 = 미배정 대기 부족 (성별 미지정은 종목 탭 제외)
  return category === 'ALL'
    ? '추천할 미배정 대기 인원이 없어요'
    : '조건에 맞는 대기 인원이 부족해요 (성별 미지정은 종목 탭에서 빠져요)';
}

function RecommendModal({
  sessionId,
  attendances,
  run,
  busy,
  onClose,
}: {
  sessionId: string;
  attendances: IAttendance[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<RecommendationCategory>('ALL');
  const [candidates, setCandidates] = useState<IGameRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCandidates(null);
    setError(null);
    try {
      setCandidates(
        await api<IGameRecommendation[]>(
          `/sessions/${sessionId}/game-recommendations?category=${category}`,
          { admin: true },
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '추천을 불러오지 못했습니다.');
    }
  }, [sessionId, category]);
  useEffect(() => {
    void load();
  }, [load]);

  // 추천은 참고용 초안 — 대기 추가는 기존 게임 생성 API 그대로
  const addToQueue = (rec: IGameRecommendation) =>
    run(async () => {
      await api(`/sessions/${sessionId}/games`, {
        method: 'POST',
        admin: true,
        body: { attendanceIds: rec.players.map((p) => p.attendanceId) },
      });
      onClose();
    });

  return (
    <Sheet
      ariaLabel="게임 추천"
      onClose={onClose}
      width="sm:max-w-4xl"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">게임 추천</h2>
          <p className="min-w-0 text-xs text-faint">참고용이에요 — 넣을지는 운영진 마음!</p>
          <button
            onClick={() => void load()}
            className="ml-auto h-9 shrink-0 rounded-lg bg-panel2 px-3 text-sm text-dim"
          >
            다시 추천
          </button>
        </>
      }
    >
      {/* 종목 탭 — 전환 시 해당 구성으로 재요청 */}
      <div className="flex flex-wrap gap-1.5 pb-3">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setCategory(tab.value)}
            className={`h-9 rounded-lg border px-3 text-sm font-medium ${
              category === tab.value
                ? 'border-court bg-court/10 text-court'
                : 'border-line text-dim'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 scroll-area">
        {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
        {!error && candidates === null && (
          <p className="py-10 text-center text-sm text-dim">추천 계산 중...</p>
        )}
        {candidates?.length === 0 && (
          <p className="py-10 text-center text-sm text-faint">
            {emptyMessage(category, attendances)}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {candidates?.map((rec) => {
            const meta = KIND_META[rec.kind];
            return (
              <div
                key={rec.kind}
                className={`flex flex-col rounded-xl border bg-panel2 p-4 ${meta.border}`}
              >
                {/* 종류 라벨 + 성별 구성(혼복/남복/여복/혼성 N:N)을 한 줄, 설명은 아래 줄 */}
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 font-bold ${meta.text}`}>{meta.label}</span>
                  <span className="ml-auto shrink-0 rounded bg-panel px-1.5 py-0.5 text-caption font-medium text-dim">
                    {rec.genderLabel}
                  </span>
                </div>
                <span className="mt-0.5 text-caption text-faint">{meta.desc}</span>
                <div className="mt-3 flex flex-col gap-2">
                  {rec.players.map((player) => (
                    <div key={player.attendanceId} className="flex items-center gap-1.5 text-sm">
                      <GradeBadge grade={player.grade} />
                      {/* 이름이 핵심 정보 — 뱃지·통계에 밀려도 최소 한글 4자는 보장 */}
                      <span className="min-w-[4em] truncate font-medium">{player.name}</span>
                      <GenderMarker gender={player.gender} />
                      {player.isGuest && <span className="text-caption text-sky">G</span>}
                      {player.borrowedFrom && (
                        <span className="shrink-0 rounded bg-court/15 px-1 py-0.5 text-caption font-medium text-court">
                          {player.borrowedFrom === 'PLAYING' ? '게임 중' : '대기 조합'}
                        </span>
                      )}
                      <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
                        {player.gamesPlayed}게임 · {player.waitingMinutes}분
                      </span>
                    </div>
                  ))}
                </div>
                <PartnerNote
                  people={rec.players.map((p) => ({
                    id: p.attendanceId,
                    name: p.name,
                    partnerId: attendances.find((a) => a.id === p.attendanceId)?.partnerAttendanceId ?? null,
                  }))}
                />
                {rec.repeatPairCount > 0 && (
                  <p className="mt-2 text-caption text-faint">
                    오늘 같이 뛴 쌍 {rec.repeatPairCount}개 포함
                  </p>
                )}
                <button
                  onClick={() => void addToQueue(rec)}
                  disabled={busy}
                  className="mt-3 h-11 rounded-lg bg-court text-sm font-bold text-bg disabled:opacity-50"
                >
                  대기에 추가
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

// ===== 체크인 코드 모달 =====

// 모임원이 /checkin에서 입력하는 코드 — 소모임 공지사항의 작성월일(MMDD)에 맞춰 운영진이 관리
// 코드는 운영진 전용 엔드포인트에서 취득(공개 스냅샷엔 없음)
function CheckInCodeModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null | undefined>(undefined); // undefined=로딩, null=코드없음
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ICheckInCodeResponse>('/sessions/current/checkin-code', { admin: true })
      .then((d) => setCode(d.code))
      .catch((e) => setError(e instanceof ApiError ? e.message : '코드를 불러오지 못했습니다.'));
  }, []);

  return (
    <Sheet
      ariaLabel="입장 코드"
      onClose={onClose}
      width="sm:max-w-sm"
      bodyClassName="flex min-h-0 flex-1 flex-col items-center gap-4 pb-2 text-center scroll-area"
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">입장 코드</h2>}
    >
      {error && <p className="py-8 text-sm text-coral">{error}</p>}
      {code === undefined && !error && <p className="py-8 text-sm text-dim">불러오는 중...</p>}
      {code === null && <p className="py-8 text-sm text-faint">이 모임엔 코드가 없어요(구 버전 세션)</p>}
      {code && (
        <>
          <div>
            <p className="tabular font-mono text-5xl font-bold tracking-[0.2em]">{code}</p>
            <p className="mt-2 text-xs leading-relaxed text-dim">
              모임원은 <b>[필독]공지사항</b>의 작성월일 4자리를 입력해요
            </p>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              미리 출석 처리해 둔 사람도 이 코드로 한 번 들어오면 폰이 연결돼 내 차례와 코트 알림을 받아요
            </p>
            <p className="mt-1 text-xs text-faint">공지를 새로 올렸다면 코드도 함께 바꿔주세요</p>
          </div>
          <CodeEditor current={code} onChanged={setCode} />
        </>
      )}
    </Sheet>
  );
}

// 코드 변경 — 공지사항 작성월일(MMDD)로 맞춘다. 바꾼 값은 다음 모임에도 승계되므로
// 공지를 새로 올릴 때만 손대면 된다 (코드는 방어선이 아니고 콕 확인이 게이트)
function CodeEditor({
  current,
  onChanged,
}: {
  current: string;
  onChanged: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => {
          setDraft(current);
          setError(null);
          setOpen(true);
        }}
        className="tap text-xs text-dim underline underline-offset-4"
      >
        코드 변경
      </button>
    );
  }

  const save = async () => {
    if (busy || draft.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ICheckInCodeResponse>('/sessions/current/checkin-code', {
        method: 'PATCH',
        admin: true,
        body: { code: draft },
      });
      if (res.code) onChanged(res.code);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '코드를 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        placeholder="공지 작성월일 4자리 (예: 0715)"
        autoComplete="off"
        className="tabular h-12 w-full rounded-lg border-2 border-transparent bg-panel2 text-center font-mono text-lg tracking-[0.2em] outline-none placeholder:font-sans placeholder:text-xs placeholder:tracking-normal focus:border-court"
      />
      <p className="text-caption leading-relaxed text-faint">
        바꾼 코드는 다음 모임에도 그대로 이어져요 — 공지를 새로 올릴 때만 바꾸면 돼요
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="h-11 flex-1 rounded-lg bg-panel2 text-sm text-dim"
        >
          취소
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || draft.length !== 4}
          className="h-11 flex-1 rounded-lg bg-court text-sm font-bold text-bg disabled:bg-panel2 disabled:text-faint"
        >
          저장
        </button>
      </div>
      {error && <p className="text-xs text-coral">{error}</p>}
    </div>
  );
}

// ===== 선수 교체 모달 =====

// 부상·급한 일로 게임 중/대기 조합에서 한 명만 바꾼다 — 게임을 갈아엎지 않아 타이머·큐 순서 유지
function ReplacePlayerModal({
  game,
  attendances,
  run,
  busy,
  onClose,
}: {
  game: IGame;
  attendances: IAttendance[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [outId, setOutId] = useState<string | null>(null);
  const [inId, setInId] = useState<string | null>(null);

  const isPlaying = game.status === 'PLAYING';
  const playerIds = new Set((game.players ?? []).map((p) => p.attendanceId));
  // 후보: 퇴장·휴식·이 게임 인원 제외. 게임 중 게임엔 다른 코트에서 뛰는 사람 투입 불가(PLAYING 동시 한 곳만)
  const candidates = attendances.filter(
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
                <GenderMarker gender={member.gender} />
              </button>
            );
          })}
        </div>

        <h3 className="pt-4 pb-1.5 text-sm font-bold text-court">들어올 사람</h3>
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
                <GenderMarker gender={member.gender} />
                {member.isGuest && <span className="text-caption text-sky">G</span>}
                {attendance.status !== 'CHECKED_IN' && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-caption font-medium ${
                      attendance.status === 'PLAYING'
                        ? 'bg-court/15 text-court'
                        : 'bg-amber/15 text-amber'
                    }`}
                  >
                    {attendance.status === 'PLAYING' ? '게임 중' : '대기 조합'}
                  </span>
                )}
                <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
                  {attendance.gamesPlayed}게임
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

// ===== 운영 메모 패널 (대기 인원 컬럼 하단 상시 노출) =====

// 세션 무관 전역 메모 — 모임 종료에도 유지, 처리한 건 ✕(=완료), [초기화]는 2탭 확인.
// 운영진 전용 데이터라 공개 스냅샷에 없음 → 스냅샷 이벤트를 재조회 트리거로만 사용
function MemoPanel({
  snapshot,
  run,
  busy,
}: {
  snapshot: ISessionSnapshot;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [memos, setMemos] = useState<IAdminMemo[]>([]);
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemos(await api<IAdminMemo[]>('/memos', { admin: true }));
    } catch {
      // 조회 실패는 치명적이지 않음 — 다음 스냅샷 이벤트에서 재시도된다
    }
  }, []);
  // 스냅샷이 바뀔 때마다 재조회 — 다른 운영진 기기의 메모 변경이 브로드캐스트를 타고 반영된다
  useEffect(() => {
    void load();
  }, [load, snapshot]);

  const add = () => {
    const content = input.trim();
    if (!content) return;
    void run(async () => {
      await api('/memos', { method: 'POST', admin: true, body: { content } });
      setInput('');
      await load();
    });
  };

  const remove = (id: string) =>
    run(async () => {
      await api(`/memos/${id}`, { method: 'DELETE', admin: true });
      await load();
    });

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000); // 4초 내 재탭 시 실행
      return;
    }
    setConfirmClear(false);
    void run(async () => {
      await api('/memos/clear', { method: 'DELETE', admin: true });
      await load();
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl bg-panel">
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-bold text-sky">
        메모
        <span className="tabular font-mono text-xs text-faint">{memos.length}</span>
        {memos.length > 0 && (
          <button
            onClick={clearAll}
            className={`tap ml-auto h-7 rounded-lg border px-2.5 text-xs font-medium ${
              confirmClear ? 'border-coral bg-coral/15 text-coral' : 'border-line text-dim'
            }`}
          >
            {confirmClear ? '한 번 더 누르면 전체 삭제' : '초기화'}
          </button>
        )}
      </h2>
      {memos.length > 0 && (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
          {memos.map((memo) => (
            <li
              key={memo.id}
              className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">{memo.content}</span>
              <button
                onClick={() => void remove(memo.id)}
                disabled={busy}
                title="완료 (삭제)"
                className="tap h-7 w-7 shrink-0 rounded-lg text-xs text-dim hover:text-coral"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 p-3">
        <ClearableInput
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          maxLength={200}
          placeholder="메모 — 모임 끝나도 유지돼요"
          className="h-10 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-court"
          onClear={() => setInput('')}
          wrapperClassName="min-w-0 flex-1"
        />
        <button
          onClick={add}
          disabled={!input.trim() || busy}
          className="h-10 shrink-0 rounded-lg bg-court/10 px-3 text-sm font-medium text-court disabled:opacity-50"
        >
          추가
        </button>
      </div>
    </section>
  );
}

// ===== 이스터에그 — 대기 인원 헤더 히든 존 13연타 시 모임장 응원 =====

const CHEER_TAPS = 13;
const CHEER_TAP_GAP_MS = 1000; // 이 간격 안에 이어서 눌러야 카운트 유지
const CHEER_DURATION_MS = 10_000; // 이 동안은 탭을 삼켜 유지 — 연타 여운으로 바로 닫히던 문제 해결

function CheerEasterEgg({ onDone }: { onDone: () => void }) {
  // 낙하 반짝이 — 마운트 시 한 번만 랜덤 생성(무한 반복이라 10초 내내 쏟아진다)
  const sparkles = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2.6,
        size: 14 + Math.random() * 20,
        emoji: ['✨', '🌟', '💫', '🏸', '⭐', '🎉'][i % 6],
      })),
    [],
  );
  // 글자 주변 제자리 반짝임 — 촌스러운 후광 연출용
  const twinkles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        top: -20 + Math.random() * 140,
        left: -10 + Math.random() * 120,
        delay: Math.random() * 1.1,
        size: 12 + Math.random() * 16,
        emoji: ['✨', '⭐', '💖', '🌟'][i % 4],
      })),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(onDone, CHEER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);
  // 응원 대상 = 모임원 관리에서 역할이 모임장인 사람 (여럿이면 전원, 없거나 조회 실패면 "모임장")
  // null = 조회 중 — 문구를 바꿔치기하며 깜빡이지 않도록 이름이 정해진 뒤에 띄운다
  const [leaderName, setLeaderName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<IMemberSummary[]>('/members', { admin: true })
      .then((members) => {
        const names = members
          .filter((m) => m.role === MemberRole.LEADER && !m.deletedAt)
          .map((m) => m.name);
        if (!cancelled) setLeaderName(names.length > 0 ? names.join('·') : '모임장');
      })
      .catch(() => {
        if (!cancelled) setLeaderName('모임장');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    // 클릭/터치를 전부 삼킨다 — 10초 동안 화면이 눌리지 않게 (닫기는 타이머만)
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 flex touch-none select-none items-center justify-center overflow-hidden bg-black/50"
    >
      {sparkles.map((s) => (
        <span
          key={s.id}
          className="sparkle-fall absolute top-0"
          style={{ left: `${s.left}%`, animationDelay: `${s.delay}s`, fontSize: s.size }}
        >
          {s.emoji}
        </span>
      ))}
      <div className="relative">
        {/* 회전하는 무지개 후광 — 글자 뒤 */}
        <div className="cheer-glow absolute -inset-x-20 -inset-y-14 rounded-full" />
        {twinkles.map((t) => (
          <span
            key={t.id}
            className="cheer-twinkle absolute"
            style={{
              top: `${t.top}%`,
              left: `${t.left}%`,
              animationDelay: `${t.delay}s`,
              fontSize: t.size,
            }}
          >
            {t.emoji}
          </span>
        ))}
        {/* 폰에서는 두 줄, 태블릿 이상은 한 줄 — 긴 문구가 좁은 화면에서 깨지지 않게 */}
        {/* 폰은 vw로 상한을 둬 좁은 기기(320px)에서도 안 잘리게, 태블릿 이상은 고정 크기 */}
        {leaderName !== null && (
          <p className="cheer-pop relative text-center text-[clamp(3rem,15vw,4.5rem)] leading-tight font-bold sm:text-[6rem]">
            <span className="block sm:inline">{leaderName}</span>{' '}
            <span className="block sm:inline">화이팅!!</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ===== 수동 체크인 모달 =====

// 모임 전 사전 등록·이미 게임 중인 인원 등을 운영진이 대신 체크인
// 미등록 인원은 구두 동의 전제로 대리 등록+체크인까지 — 게스트는 이름·급수·성별만(생년월일 미수집 정책),
// 모임원은 생년월일 포함(운영진이 알 수 있음). 본인 폰 연결은 걱정 없음:
// 나중에 본인이 코드로 들어오면 409를 /checkin이 "본인 확인 완료"로 받아 /m 진입

function ManualCheckInModal({
  sessionId,
  attendances,
  run,
  busy,
  onClose,
}: {
  sessionId: string;
  attendances: IAttendance[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IMember[]>([]);
  // 선택 목록은 검색어가 바뀌어도 유지돼야 해서 결과 배열이 아닌 별도 Map으로 들고 간다
  const [selected, setSelected] = useState<Map<string, IMember>>(new Map());
  const [lastDone, setLastDone] = useState<string | null>(null); // 연속 입력용 직전 완료 표시
  const [failed, setFailed] = useState<{ name: string; message: string }[]>([]);
  // 신규 등록 폼 — 여러 명을 한 번에(공용 MultiMemberForm). 현장 대리 등록은 게스트가 흔해서 기본 게스트
  const [regOpen, setRegOpen] = useState(false);

  // 입력 후 300ms 조용하면 검색 (타이핑마다 요청하지 않도록 — /checkin과 동일 패턴)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<IMember[]>(`/members/search?name=${encodeURIComponent(trimmed)}`, { admin: true })
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 현재 세션 출석과 대조 — 이미 출석 중이면 탭 자체를 막아 쓸모없는 409를 없앤다
  const statusByMemberId = useMemo(
    () => new Map(attendances.map((a) => [a.memberId, a.status])),
    [attendances],
  );

  const toggle = (member: IMember) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(member.id)) next.set(member.id, member);
      return next;
    });

  // 선택한 인원을 한 번에 체크인 — 서버 엔드포인트가 1명 단위라 순차 호출한다
  // run()의 공통 에러 토스트는 첫 실패에서 끊기므로 여기서 개별로 잡아 성공/실패를 나눠 보고
  const checkInSelected = () => {
    const targets = [...selected.values()];
    if (targets.length === 0) return;
    void run(async () => {
      const errors: { name: string; message: string }[] = [];
      const remaining = new Map<string, IMember>();
      for (const member of targets) {
        try {
          await api(`/sessions/${sessionId}/attendances/manual`, {
            method: 'POST',
            admin: true,
            body: { memberId: member.id },
          });
        } catch (e) {
          errors.push({
            name: member.name,
            message: e instanceof ApiError ? e.message : '요청에 실패했습니다.',
          });
          remaining.set(member.id, member); // 실패한 사람만 선택으로 남겨 재시도하게
        }
      }
      setSelected(remaining);
      setFailed(errors);
      const okCount = targets.length - errors.length;
      // 모달은 열어둔다 — 지각 시나리오는 보통 여러 명 연속 입력
      setLastDone(okCount > 0 ? `${okCount}명 출석 완료` : null);
    });
  };

  // 한 명분 등록+체크인 — 개인정보 동의는 여기서 받지 않는다(대리 등록이라 본인 의사가 아님)
  // 본인이 코드로 처음 들어올 때 /checkin에서 동의를 받아 기록한다
  const registerAndCheckIn = async (body: NewMemberBody) => {
    const created = await api<IMember>('/members', { method: 'POST', admin: true, body });
    await api(`/sessions/${sessionId}/attendances/manual`, {
      method: 'POST',
      admin: true,
      body: { memberId: created.id },
    });
  };

  // 비슷한 이름 목록에서 기존 사람을 고르면 등록 없이 바로 체크인
  const checkInExisting = async (member: IMember) => {
    await api(`/sessions/${sessionId}/attendances/manual`, {
      method: 'POST',
      admin: true,
      body: { memberId: member.id },
    });
  };

  return (
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel="출석 추가"
      dismissible={false}
      onClose={onClose}
      width="sm:max-w-xl"
      // 높이 고정 — 검색 결과 수에 따라 시트가 커졌다 작아지지 않게
      height="h-[88dvh] sm:h-[min(720px,88dvh)]"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-heading font-bold whitespace-nowrap">
            {regOpen ? '신규 등록 + 출석' : '출석 추가'}
          </h2>
          <p className="min-w-0 truncate text-caption text-faint">
            {regOpen ? '검색에 없는 사람' : '사전 등록·현장 대리'}
          </p>
        </>
      }
      footer={
        regOpen ? (
          <button
            onClick={() => setRegOpen(false)}
            className="tap h-12 w-full rounded-xl bg-panel2 text-body-sm font-medium text-dim"
          >
            ‹ 검색으로 돌아가기
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setRegOpen(true)}
              className="tap h-13 shrink-0 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-sky"
            >
              + 신규 등록
            </button>
            <button
              onClick={checkInSelected}
              disabled={busy || selected.size === 0}
              className="tap h-13 flex-1 rounded-xl bg-court text-body font-bold text-bg disabled:bg-line disabled:text-faint"
            >
              {selected.size > 0 ? `${selected.size}명 출석` : '출석할 사람을 고르세요'}
            </button>
          </div>
        )
      }
    >
      {/* 머리글 아래 전체가 한 덩어리로 스크롤 — 검색 결과만 스크롤하면 AI 결과·선택 인원이
          커질 때 줄어들지 못하고 팝업 상자 밖으로 넘친다 */}
      <div className="flex min-h-0 flex-1 flex-col scroll-area">
        {lastDone && <p className="pb-2 text-body-sm font-medium text-court">{lastDone}</p>}
        {failed.length > 0 && (
          <div className="pb-2">
            {failed.map((f) => (
              <p key={f.name} className="text-body-sm font-medium text-coral">
                {f.name}님 실패 — {f.message}
              </p>
            ))}
          </div>
        )}

        {regOpen ? (
          // 신규 대리 등록 — 검색에 없는 인원을 즉석 등록+체크인 (기본 게스트)
          <div className="flex flex-col gap-3">
            <MultiMemberForm
              defaultGuest
              initialName={query.trim()} // 방금 검색한 이름 이어받기
              actionLabel="등록 + 출석"
              register={registerAndCheckIn}
              pickExisting={{ label: '이 사람 출석', action: checkInExisting }}
              onFinished={(done, remaining) => {
                // 체크인은 소켓 스냅샷으로 보드에 바로 반영된다 — 여기선 결과 문구만
                if (done.length > 0) setLastDone(`${done.join(', ')}님 출석 완료`);
                setFailed([]);
                if (remaining === 0) setRegOpen(false);
              }}
            />
            <p className="text-caption leading-relaxed text-faint">
              게스트는 생년월일을 받지 않아요. 모임원은 본인 폰에서 입장 코드를 넣으면 이 계정으로
              연결돼요. 등록은 본인에게 구두로 동의받아 주세요.
            </p>
          </div>
        ) : (
          <>
            {/* AI 체크인 — 접힌 한 줄, 서버에 AI 키가 없으면 스스로 숨는다 */}
            <AiCheckInPanel sessionId={sessionId} attendances={attendances} run={run} />

            <div className="relative shrink-0">
              <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-faint">
                <SearchIcon />
              </span>
              <ClearableInput
                autoComplete="off"
                enterKeyHint="search"
                aria-label="모임원 이름 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름으로 검색"
                className="h-12 rounded-xl border-2 border-transparent bg-panel2 pl-11 text-body outline-none placeholder:text-faint focus:border-court"
                onClear={() => setQuery('')}
              />
            </div>

            {/* 선택 인원 — 검색어를 바꿔도 남으므로 여기서 전체를 확인하고 해제할 수 있게 */}
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-3">
                {[...selected.values()].map((member) => (
                  <button
                    key={member.id}
                    onClick={() => toggle(member)}
                    aria-label={`${member.name} 선택 빼기`}
                    className="tap flex h-9 items-center gap-1.5 rounded-lg bg-court/10 px-3 text-body-sm font-medium text-court"
                  >
                    {member.name}
                    <span className="text-faint">✕</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-col gap-1">
              {results.map((member) => {
                const status = statusByMemberId.get(member.id);
                const present = status !== undefined && status !== 'LEFT';
                const picked = selected.has(member.id);
                return (
                  <button
                    key={member.id}
                    onClick={() => !present && toggle(member)}
                    disabled={present}
                    aria-pressed={picked}
                    className={`flex min-h-14 items-center gap-2.5 rounded-xl px-3 text-left ${
                      present ? 'bg-panel2 opacity-50' : picked ? 'bg-court/12' : 'bg-panel2'
                    }`}
                  >
                    <span
                      className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md text-caption font-bold ${
                        picked ? 'bg-court text-bg' : 'bg-line text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <GradeBadge grade={member.grade} />
                    <span className={`truncate text-body ${picked ? 'font-bold' : 'font-medium'}`}>{member.name}</span>
                    <GenderMarker gender={member.gender} />
                    {present && (
                      <span className="shrink-0 rounded bg-court/15 px-1.5 py-0.5 text-caption font-medium text-court">
                        출석 중
                      </span>
                    )}
                    {status === 'LEFT' && (
                      <span className="shrink-0 rounded bg-amber/15 px-1.5 py-0.5 text-caption font-medium text-amber">
                        퇴장 — 재입장
                      </span>
                    )}
                    {/* 동명이인 구분용 생년월일 */}
                    <span
                      className={`ml-auto shrink-0 text-caption ${
                        member.isGuest ? 'text-sky' : 'tabular font-mono text-dim'
                      }`}
                    >
                      {member.isGuest ? '게스트' : (member.birthDate ?? '생년월일 없음')}
                    </span>
                  </button>
                );
              })}
              {query.trim() && results.length === 0 && (
                <p className="py-6 text-center text-body-sm text-faint">
                  검색 결과가 없어요. 아래 [+ 신규 등록]으로 등록하면서 바로 출석 처리할 수 있어요.
                </p>
              )}
              {!query.trim() && (
                <p className="py-6 text-center text-body-sm text-faint">
                  이름으로 찾아 여러 명을 고른 뒤 한 번에 출석 처리해요
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ===== 모임원 관리 모달 =====

// 명단 조회·수정·정리 — 자가 가입을 막은 대가로 명단 관리가 전적으로 운영진 책임이라 이 화면이 필요하다
// 세션과 무관한 회원 원장 작업이라 Board 밖(StartScreen)에서도 열 수 있게 스냅샷·run에 의존하지 않는다
const ROLE_LABEL: Record<MemberRole, string> = {
  LEADER: '모임장',
  MANAGER: '운영진',
  MEMBER: '모임원',
};
const STALE_GUEST_DAYS = 90; // 정리 안내 문구용 — 판정은 서버(members.service STALE_GUEST_DAYS)와 같은 값

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === 'MEMBER') return null; // 대다수가 모임원 — 배지는 예외(모임장·운영진)만
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-caption font-medium ${
        role === 'LEADER' ? 'bg-amber/15 text-amber' : 'bg-court/15 text-court'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

// 마지막 출석일 압축 표기 — 좁은 폰 한 줄에 들어가야 해서 연도는 다를 때만
function formatLastAttended(date: string | null): string {
  if (!date) return '출석 없음';
  const [y, m, d] = date.split('-');
  const thisYear = String(new Date().getFullYear());
  return y === thisYear ? `${Number(m)}/${Number(d)}` : `${y.slice(2)}.${Number(m)}.${Number(d)}`;
}

const SORT_OPTIONS: { value: MemberListSort; label: string }[] = [
  { value: 'RECENT', label: '최근 출석순' },
  { value: 'NAME', label: '이름순' },
  { value: 'ATTENDANCE', label: '출석 많은 순' },
  { value: 'CREATED', label: '최근 등록순' },
  { value: 'GRADE', label: '급수 순' },
];

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function MembersManagerModal({ onClose }: { onClose: () => void }) {
  // 서버가 탭·검색에 맞는 100명씩 + 탭별 전체 인원을 준다(모임원이 늘어도 가볍게)
  const [data, setData] = useState<IMemberPage | null>(null); // null=첫 로딩
  const [staleGuests, setStaleGuests] = useState<IMemberSummary[]>([]);
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState(''); // 입력이 300ms 멈춘 뒤의 검색어 — 타이핑마다 요청하지 않게
  const [filter, setFilter] = useState<MemberListFilter>('ALL');
  const [sort, setSort] = useState<MemberListSort>('RECENT');
  const [pages, setPages] = useState(1); // 지금까지 이어 받은 쪽 수 — 끝까지 내리면 하나씩 늘어난다
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef(0); // 탭·검색이 바뀐 뒤 늦게 온 이전 응답을 버리려고
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<IMemberSummary | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const { toast, showToast } = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const fetchPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams({ filter, sort, page: String(page), ...(keyword && { q: keyword }) });
      return api<IMemberPage>(`/members/page?${params}`, { admin: true });
    },
    [filter, sort, keyword],
  );

  // 첫 쪽부터 count쪽까지 다시 받아 이어 붙인다 — 수정·등록 뒤에도 보던 범위(스크롤 위치)가 유지되게
  const reload = useCallback(
    async (count: number) => {
      const id = ++requestRef.current;
      try {
        const stale = api<IMemberSummary[]>('/members/stale-guests', { admin: true });
        const chunks = await Promise.all(Array.from({ length: count }, (_, i) => fetchPage(i + 1)));
        const staleList = await stale;
        if (id !== requestRef.current) return;
        setData({ ...chunks[chunks.length - 1], items: chunks.flatMap((c) => c.items) });
        setPages(count);
        setStaleGuests(staleList);
      } catch {
        if (id === requestRef.current) showToast('명단을 불러오지 못했습니다.');
      }
    },
    [fetchPage, showToast],
  );
  // 탭·검색어·정렬이 바뀌면 첫 쪽부터, 목록도 맨 위로
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    void reload(1);
  }, [reload]);
  const refetch = () => reload(pages);

  const hasMore = data !== null && data.items.length < data.total;
  // 다음 100명 — 목록 끝 표시(sentinel)가 보이면 부른다
  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const id = requestRef.current;
    setLoadingMore(true);
    try {
      const next = await fetchPage(pages + 1);
      if (id !== requestRef.current) return;
      setData((prev) => prev && { ...next, items: [...prev.items, ...next.items] });
      setPages(pages + 1);
    } catch {
      showToast('명단을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  // 불러온 뒤에도 끝 표시가 아직 보이면(목록이 짧은 화면) 바로 한 번 더 — 다시 관찰을 걸면 즉시 알려 준다
  const loadedCount = data?.items.length ?? 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && void loadMoreRef.current(),
      { root: listRef.current, rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadedCount]);

  // 모달 전용 실행기 — Board의 run은 스냅샷 refetch까지 묶여 있어 세션 없는 화면에선 못 쓴다
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const visible = data?.items ?? [];

  // 탭 숫자는 검색과 상관없이 진짜 전체 인원(서버 counts)
  const FILTER_TABS: { value: MemberListFilter; label: string }[] = [
    { value: 'ALL', label: '전체' },
    { value: 'REGULAR', label: '모임원' },
    { value: 'GUEST', label: '게스트' },
    { value: 'DELETED', label: '삭제됨' },
  ];

  return (
    // 안에서 여는 시트·알림은 시트 바깥에 둔다 — 시트는 움직이는(transform) 상자라 그 안의 fixed 요소는 위치가 깨진다
    <>
      <Sheet
        ariaLabel="모임원 관리"
        onClose={onClose}
        width="sm:max-w-3xl"
        // 높이 고정 — 검색 결과 수에 따라 시트가 커졌다 작아지지 않게
        height="h-[88dvh] sm:h-[min(720px,88dvh)]"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        header={
          <>
            <h2 className="shrink-0 text-heading font-bold whitespace-nowrap">모임원 관리</h2>
            {data && <span className="tabular font-mono text-body-sm text-faint">{data.counts.ALL}명</span>}
          </>
        }
        footer={
          <div className="flex items-center gap-2">
            {/* 등록 — 체크인 없이 명단에만 추가 (모임 전 사전 등록용). 모임 중 즉석 등록+체크인은 [수동 체크인]의 [신규 등록] */}
            <button
              onClick={() => setRegisterOpen(true)}
              className="tap h-12 flex-1 rounded-xl bg-court text-body font-bold text-bg sm:ml-auto sm:flex-none sm:px-6"
            >
              + 신규 등록
            </button>
          </div>
        }
      >
        <div className="relative shrink-0">
          <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-faint">
            <SearchIcon />
          </span>
          <ClearableInput
            autoComplete="off"
            enterKeyHint="search"
            aria-label="이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름으로 검색"
            className="h-12 rounded-xl border-2 border-transparent bg-panel2 pl-11 text-body outline-none placeholder:text-faint focus:border-court"
            onClear={() => setQuery('')}
          />
        </div>
        <div className="mt-3 flex shrink-0 gap-1.5 overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              aria-pressed={filter === tab.value}
              className={`tap h-9 shrink-0 rounded-lg px-3 text-body-sm ${
                filter === tab.value ? 'bg-court/15 font-bold text-court' : 'bg-panel2 text-dim'
              }`}
            >
              {tab.label}
              {data && <span className="tabular ml-1 font-mono font-medium">{data.counts[tab.value]}</span>}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center pt-2 pb-2">
          <span className="text-caption text-faint">
            {data ? `${keyword ? '검색 결과 ' : ''}${data.total}명` : ''}
          </span>
          {/* 폰에선 OS 선택 창이 떠서 고르기 쉽다 — 글자처럼 보이게만 꾸민다 */}
          <label className="relative ml-auto flex items-center text-body-sm text-dim">
            <span className="sr-only">정렬</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as MemberListSort)}
              className="h-9 appearance-none bg-transparent pr-6 pl-2 text-right outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </label>
        </div>

        {/* 오래 안 온 게스트 정리 — 게스트 탭에서만, 목록 바로 위 */}
        {filter === 'GUEST' && staleGuests.length > 0 && (
          <div className="mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-amber/10 py-2 pr-2 pl-3.5">
            <span className="min-w-0 text-body-sm text-amber">
              {STALE_GUEST_DAYS}일 넘게 안 온 게스트 <b>{staleGuests.length}명</b>
            </span>
            <button
              onClick={() => setCleanupOpen(true)}
              className="tap ml-auto h-9 shrink-0 rounded-lg bg-amber px-3 text-body-sm font-bold text-bg"
            >
              정리하기
            </button>
          </div>
        )}

        {/* 남는 높이를 다 쓰고 이 안에서만 스크롤 — 태블릿은 두 줄 */}
        <div
          ref={listRef}
          className="grid min-h-0 flex-1 grid-cols-1 content-start gap-1.5 scroll-area sm:grid-cols-2"
        >
          {data === null && <p className="py-8 text-center text-body-sm text-dim sm:col-span-2">불러오는 중...</p>}
          {data !== null && visible.length === 0 && (
            <p className="py-8 text-center text-body-sm text-faint sm:col-span-2">
              {keyword ? '검색 결과가 없어요' : filter === 'DELETED' ? '삭제된 모임원이 없어요' : '아직 아무도 없어요'}
            </p>
          )}
          {visible.map((member) => (
            <button
              key={member.id}
              onClick={() => setEditTarget(member)}
              className={`flex min-h-15 items-center gap-2.5 rounded-xl bg-panel2 px-3 py-2.5 text-left ${
                member.deletedAt ? 'opacity-50' : ''
              }`}
            >
              <GradeBadge grade={member.grade} />
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-body font-medium">{member.name}</span>
                  <GenderMarker gender={member.gender} />
                  <RoleBadge role={member.role} />
                </span>
                <span className={`text-caption ${member.isGuest ? 'text-sky' : 'tabular font-mono text-faint'}`}>
                  {member.isGuest ? '게스트' : (member.birthDate ?? '생년월일 없음')}
                </span>
              </span>
              <span className="ml-auto flex shrink-0 flex-col items-end text-caption leading-tight">
                <span className="text-dim">{formatLastAttended(member.lastAttendedAt)}</span>
                <span className="tabular font-mono text-faint">
                  출석 {member.totalSessions} · {member.totalGames}게임
                </span>
              </span>
            </button>
          ))}
          {/* 목록 끝 표시 — 보이면 다음 100명 */}
          {hasMore && (
            <div ref={sentinelRef} className="py-4 text-center text-body-sm text-faint sm:col-span-2">
              {loadingMore ? '더 불러오는 중...' : ''}
            </div>
          )}
        </div>
      </Sheet>
      {registerOpen && (
        <MemberRegisterSheet onRegistered={refetch} onClose={() => setRegisterOpen(false)} />
      )}
      {editTarget && (
        <MemberEditSheet
          member={editTarget}
          run={run}
          busy={busy}
          onClose={() => setEditTarget(null)}
        />
      )}
      {cleanupOpen && (
        <StaleGuestCleanupSheet
          guests={staleGuests}
          run={run}
          busy={busy}
          onClose={() => setCleanupOpen(false)}
        />
      )}
      {toast && <Toast toast={toast} />}
    </>
  );
}

// 신규 등록 시트 — 체크인 없이 명단에만 추가한다 (모임 전 사전 등록용, 세션 불필요)
// 모임 중 지각자 등록+체크인은 [수동 체크인]의 [신규 등록]이 담당 — 여긴 원장 작업만
function MemberRegisterSheet({
  onRegistered,
  onClose,
}: {
  onRegistered: () => Promise<unknown>; // 명단 다시 불러오기
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel="신규 등록"
      layer="z-50"
      dismissible={false}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 scroll-area"
      onClose={onClose}
      header={
        <>
          <h3 className="shrink-0 text-heading font-bold whitespace-nowrap">신규 등록</h3>
          <p className="min-w-0 truncate text-caption text-faint">출석 없이 명단에만</p>
        </>
      }
    >

      {/* 명단 정리 맥락은 모임원 등록이 기본 (현장 즉석 등록과 반대) */}
      <MultiMemberForm
        defaultGuest={false}
        actionLabel="등록"
        register={async (body) => {
          await api('/members', { method: 'POST', admin: true, body });
        }}
        onFinished={(done, remaining) => {
          void onRegistered();
          if (remaining === 0) onClose();
          else if (done.length > 0) setNotice(`${done.length}명 등록 완료 — 남은 줄을 확인해주세요`);
        }}
      />
      {notice && <p className="text-body-sm font-medium text-court">{notice}</p>}
      <p className="text-caption leading-relaxed text-faint">
        개인정보 동의는 본인이 처음 입장 코드로 들어올 때 받아요. 등록은 본인에게 구두로 동의받아
        주세요.
      </p>
    </Sheet>
  );
}

// 수정 시트 — 목록 위에 겹쳐 뜬다 (폰에서 한 화면에 폼과 목록을 같이 두기엔 좁다)
function MemberEditSheet({
  member,
  run,
  busy,
  onClose,
}: {
  member: IMemberSummary;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [birth, setBirth] = useState(formatBirthInput(member.birthDate ?? ''));
  const [grade, setGrade] = useState<Grade>(member.grade);
  const [gender, setGender] = useState<Gender | null>(member.gender);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [promote, setPromote] = useState(false); // 게스트→모임원 승격 의사
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAnon, setConfirmAnon] = useState(false);
  const birthDate = parseBirthDate(birth);
  const birthDigits = birth.replace(/\D/g, '');
  const deleted = member.deletedAt !== null;

  // 게스트는 승격을 켰을 때만 생년월일·역할을 다룬다 (게스트 정책: 생년월일 미수집, 역할 불가)
  const asRegular = !member.isGuest || promote;

  const save = () => {
    const dto: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== member.name) dto.name = name.trim();
    if (asRegular && birthDate && birthDate !== member.birthDate) dto.birthDate = birthDate;
    if (grade !== member.grade) dto.grade = grade;
    if (gender && gender !== member.gender) dto.gender = gender;
    if (asRegular && role !== member.role) dto.role = role;
    if (promote) dto.isGuest = false;
    if (Object.keys(dto).length === 0) {
      onClose();
      return;
    }
    void run(async () => {
      await api(`/members/${member.id}`, { method: 'PATCH', admin: true, body: dto });
      onClose();
    });
  };

  const blocked =
    busy || !name.trim() || (promote && !birthDate) || (asRegular && birthDigits.length === 8 && !birthDate);

  return (
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel={`${member.name} 수정`}
      layer="z-50"
      dismissible={false}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 scroll-area"
      onClose={onClose}
      header={
        <>
          <h3 className="min-w-0 truncate font-bold text-court">{member.name}</h3>
          {member.isGuest && <span className="text-caption text-sky">게스트</span>}
          {deleted && <span className="text-caption text-coral">삭제됨</span>}
        </>
      }
    >
      <p className="text-caption text-faint">
        출석 {member.totalSessions}회 · {member.totalGames}게임 · 최근{' '}
        {formatLastAttended(member.lastAttendedAt)}
      </p>

      {!deleted && (
        <>
          <ClearableInput
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="이름"
            className="h-11 rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
            onClear={() => setName('')}
          />

          {member.isGuest && (
            <button
              onClick={() => setPromote((v) => !v)}
              className={`min-h-10 rounded-lg border px-3 text-sm font-bold whitespace-normal ${
                promote ? 'border-court bg-court/15 text-court' : 'border-line bg-panel2 text-dim'
              }`}
            >
              {promote ? '모임원으로 바꾸기 — 생년월일을 입력해주세요' : '모임원으로 바꾸기'}
            </button>
          )}

          {asRegular && (
            <div>
              <ClearableInput
                autoComplete="off"
                type="text"
                inputMode="numeric"
                value={birth}
                onChange={(e) => setBirth(formatBirthInput(e.target.value))}
                placeholder="생년월일 8자리 (예: 19970312)"
                className="h-11 w-full rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
                onClear={() => setBirth('')}
              />
              {birthDigits.length === 8 && !birthDate && (
                <p className="mt-1 text-xs text-coral">날짜가 올바르지 않아요</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-6 gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`h-10 rounded-lg border text-sm font-bold ${
                  grade === g ? 'border-court bg-court/15 text-court' : 'border-line bg-panel2 text-dim'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setGender('MALE')}
              className={`h-10 rounded-lg border text-sm font-bold ${
                gender === 'MALE' ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel2 text-dim'
              }`}
            >
              ♂ 남
            </button>
            <button
              onClick={() => setGender('FEMALE')}
              className={`h-10 rounded-lg border text-sm font-bold ${
                gender === 'FEMALE' ? 'border-pink bg-pink/15 text-pink' : 'border-line bg-panel2 text-dim'
              }`}
            >
              ♀ 여
            </button>
          </div>

          {/* 역할 — 표시·명단 구분용. 권한은 단일 패스코드 그대로라 접근이 달라지진 않는다 */}
          {asRegular && (
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`h-10 rounded-lg border text-sm font-bold ${
                    role === r
                      ? r === 'LEADER'
                        ? 'border-amber bg-amber/15 text-amber'
                        : 'border-court bg-court/15 text-court'
                      : 'border-line bg-panel2 text-dim'
                  }`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={save}
            disabled={blocked}
            className="h-11 rounded-xl bg-court text-sm font-bold text-bg disabled:opacity-50"
          >
            저장
          </button>
        </>
      )}

      {!deleted && <AliasEditor memberId={member.id} />}

      {/* 위험 구역 — 삭제·익명화는 2탭 확인 (단일 패스코드 구조라 권한 대신 실수 방지로 지킨다) */}
      <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3">
        {deleted ? (
          <button
            onClick={() =>
              void run(async () => {
                await api(`/members/${member.id}/restore`, { method: 'PATCH', admin: true });
                onClose();
              })
            }
            disabled={busy}
            className="min-h-11 rounded-xl bg-court/10 px-3 text-sm font-bold whitespace-normal text-court disabled:opacity-50"
          >
            복구 — 명단에 다시 표시
          </button>
        ) : (
          <button
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void run(async () => {
                await api(`/members/${member.id}`, { method: 'DELETE', admin: true });
                onClose();
              });
            }}
            disabled={busy}
            className={`min-h-11 rounded-xl border px-3 text-sm font-medium whitespace-normal disabled:opacity-50 ${
              confirmDelete ? 'border-coral bg-coral/15 text-coral' : 'border-line text-dim'
            }`}
          >
            {confirmDelete ? '한 번 더 누르면 삭제돼요 (복구 가능)' : '명단에서 삭제'}
          </button>
        )}
        <button
          onClick={() => {
            if (!confirmAnon) {
              setConfirmAnon(true);
              return;
            }
            void run(async () => {
              await api(`/members/${member.id}/anonymize`, { method: 'PATCH', admin: true });
              onClose();
            });
          }}
          disabled={busy}
          className={`min-h-11 rounded-xl border px-3 text-sm font-medium whitespace-normal disabled:opacity-50 ${
            confirmAnon ? 'border-coral bg-coral/15 text-coral' : 'border-line text-dim'
          }`}
        >
          {confirmAnon ? '한 번 더 누르면 개인정보가 지워져요 (복구 불가)' : '개인정보 삭제 (본인 요청 시)'}
        </button>
        <p className="text-caption leading-relaxed text-faint">
          삭제는 명단에서만 감춰요(기록 유지·복구 가능). 개인정보 삭제는 이름·생년월일·성별을
          지우고 출석·게임 기록만 남겨요 — 본인이 요청했을 때만 사용하세요.
        </p>
      </div>
    </Sheet>
  );
}

// 오래 안 온 게스트 일괄 정리 — 자동 삭제는 하지 않는다(조용히 사라지면 현장에서 "왜 이름이 없지"가 된다)
// 운영진이 목록을 보고 골라서 지운다. 삭제는 soft라 실수해도 [삭제됨] 탭에서 복구 가능
function StaleGuestCleanupSheet({
  guests,
  run,
  busy,
  onClose,
}: {
  guests: IMemberSummary[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(guests.map((g) => g.id)), // 기본 전체 선택 — 이미 조건으로 걸러진 명단이고 2탭 확인이 남아 있다
  );
  const [confirm, setConfirm] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const removeSelected = () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    void run(async () => {
      // 서버 엔드포인트가 1명 단위라 순차 호출 — 수동 체크인 다중 선택과 같은 패턴
      for (const id of selected) {
        await api(`/members/${id}`, { method: 'DELETE', admin: true });
      }
      onClose();
    });
  };

  return (
    <Sheet
      ariaLabel="오래 안 온 게스트 정리"
      layer="z-50"
      onClose={onClose}
      header={<h3 className="shrink-0 font-bold whitespace-nowrap text-amber">오래 안 온 게스트 정리</h3>}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <button
          onClick={removeSelected}
          disabled={busy || selected.size === 0}
          className={`h-11 w-full rounded-xl border text-sm font-bold disabled:opacity-50 ${
            confirm ? 'border-coral bg-coral/15 text-coral' : 'border-amber/40 text-amber'
          }`}
        >
          {confirm ? `한 번 더 누르면 ${selected.size}명이 삭제돼요` : `${selected.size}명 삭제`}
        </button>
      }
    >
      <p className="pb-3 text-xs leading-relaxed text-dim">
        {STALE_GUEST_DAYS}일 이상 안 온 게스트예요. 출석 추가 검색을 어지럽히지 않게 정리하세요 —
        삭제해도 지난 기록은 남고, [삭제됨] 탭에서 복구할 수 있어요.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 scroll-area">
        {guests.map((guest) => {
          const picked = selected.has(guest.id);
          return (
            <button
              key={guest.id}
              onClick={() => toggle(guest.id)}
              className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm ${
                picked ? 'border-amber bg-amber/10' : 'border-line bg-panel2'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-caption font-bold ${
                  picked ? 'border-amber bg-amber text-bg' : 'border-line text-transparent'
                }`}
              >
                ✓
              </span>
              <GradeBadge grade={guest.grade} />
              <span className="truncate font-medium">{guest.name}</span>
              <GenderMarker gender={guest.gender} />
              <span className="ml-auto shrink-0 text-caption text-dim">
                {formatLastAttended(guest.lastAttendedAt)}
              </span>
            </button>
          );
        })}
      </div>

    </Sheet>
  );
}

// ===== 오늘 게임 기록 모달 =====

// 완료(FINISHED) 게임만 — 진행 중은 코트 구역에 이미 보이므로 중복 노출 안 함
// 서버는 히스토리 상세 API 재사용 (OPEN 세션에도 동작, 별도 엔드포인트 안 만듦)
function TodayGamesModal({
  sessionId,
  snapshot,
  onClose,
}: {
  sessionId: string;
  snapshot: ISessionSnapshot;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<IHistorySessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(
        await api<IHistorySessionDetail>(`/history/sessions/${sessionId}`, { admin: true }),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '게임 기록을 불러오지 못했습니다.');
    }
  }, [sessionId]);
  // 스냅샷 변경마다 재조회 — 모달이 열린 동안 끝난 게임도 따라온다
  // (FINISHED는 스냅샷에 안 실리므로 브로드캐스트를 refetch 트리거로만 사용, 메모 패널과 같은 패턴)
  useEffect(() => {
    void load();
  }, [load, snapshot]);

  const q = query.trim();
  // 순번은 시간순(1 = 첫 게임)으로 매긴 뒤 최신 완료가 위로 오게 역순 — 현장에선 방금 끝난 게임을 주로 찾음
  const games = useMemo(() => {
    const numbered = (detail?.games ?? []).map((game, i) => ({ ...game, no: i + 1 })).reverse();
    if (!q) return numbered;
    return numbered.filter((game) => game.players.some((player) => player.name.includes(q)));
  }, [detail, q]);

  const timeOf = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '--:--';

  return (
    <Sheet
      ariaLabel="오늘 게임 기록"
      onClose={onClose}
      width="sm:max-w-2xl"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">오늘 게임 기록</h2>
          {detail && (
            <p className="text-xs text-faint">완료 {detail.session.finishedGameCount}게임</p>
          )}
        </>
      }
    >
      <ClearableInput
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름으로 검색"
        className="h-11 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-court"
        onClear={() => setQuery('')}
        wrapperClassName="mb-3"
      />
      {q && detail && (
        <p className="pb-2 text-xs text-dim">
          &lsquo;{q}&rsquo; 포함 <span className="font-bold text-court">{games.length}</span>게임
        </p>
      )}

      <div className="min-h-0 flex-1 scroll-area">
        {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
        {!error && detail === null && (
          <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>
        )}
        {detail && games.length === 0 && (
          <p className="py-10 text-center text-sm text-faint">
            {q ? `'${q}' 이(가) 포함된 완료 게임이 없어요` : '아직 완료된 게임이 없어요'}
          </p>
        )}
        <ul className="space-y-1.5">
          {games.map((game) => (
            <li
              key={game.id}
              className="flex items-center gap-3 rounded-xl bg-panel2 px-4 py-2.5"
            >
              <span className="tabular w-8 shrink-0 font-mono text-xs text-faint">
                #{game.no}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                {game.players.map((player, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <GradeBadge grade={player.grade} />
                    <span
                      className={
                        q && player.name.includes(q) ? 'font-bold text-court' : 'font-medium'
                      }
                    >
                      {player.name}
                    </span>
                  </span>
                ))}
              </div>
              <div className="shrink-0 text-right text-xs text-dim">
                <p>{game.courtNo != null ? `${game.courtNo}번 코트` : '코트 미지정'}</p>
                <p className="tabular font-mono text-faint">
                  {timeOf(game.startedAt)} ~ {timeOf(game.endedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

// ===== 도움말 모달 =====

// 정적 안내문 — 운영진 교체 시 구두 설명 없이 관제판을 넘길 수 있게 핵심 개념만 요약
const HELP_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: '기본 흐름',
    items: [
      '출석만으로는 게임에 못 들어가요 — 대기 인원 맨 위 [콕 확인 대기]에서 콕 낸 사람의 [콕 확인]을 눌러야 명단으로 내려와요. 그 섹션이 비어 있으면 다 처리된 거예요.',
      '콕 확인 시각이 곧 참여 시작이에요 — 일찍 와서 콕을 늦게 낸 사람이 대기 순번을 앞지르지 않아요. 잘못 눌렀으면 행의 [콕취소]로 되돌려요 (조합·게임에 든 뒤엔 불가).',
      '명단에서 4명 선택 → [조합 만들기] → 대기 조합에서 [코트 배정] → 끝나면 [게임 종료].',
      '카드의 윗줄 두 명이 한 팀, 아랫줄 두 명이 상대 팀이에요(고른 순서대로 앉아요). 팀을 바꾸려면 폰에서는 사람을 길게 눌러 고른 뒤 바꿀 사람이나 빈칸을 누르고, 태블릿에서는 같은 카드 안의 다른 사람 위로 끌어다 놓으세요.',
      '[게임 종료]만 게임 수 +1 · 대기시간 리셋. [대기로]는 조합을 유지한 채 뒤로. 카드의 [⋯]에 있는 게임 취소·해체는 없던 일로 (둘 다 미집계).',
      '부상·급한 일로 한 명만 바꿀 땐 카드 [⋯] → 교체 — 게임을 갈아엎지 않아 타이머·순서가 유지돼요. 빠진 사람은 대기로 돌아와요.',
      '대회 연습 파트너는 [마이크]에 "민수랑 준호 대회 연습한대"라고 말하면 돼요. 그날 게임 추천이 두 사람을 같은 게임에 넣는 쪽으로 기울고(둘 다 비어 있을 때만, 강제 아님) 카드에 "대회 연습: ○○·○○ 한 팀"이 보여요. 명단 이름 옆 "파트너 ○○"를 두 번 누르면 해제. 운영 메모에도 한 줄 남아요.',
      '구두 요청("무릎 조심" 등)은 메모에 적어두세요. 모임이 끝나도 남아 다음 모임에 이어지고, 처리했으면 ✕로 지워요.',
      '오늘 끝난 게임은 상단 [게임 기록]에서 확인해요 — 이름으로 검색하면 그 사람이 뛴 게임만 모아 볼 수 있어요.',
      '모임원이 폰에서 [잠깐 쉴래요]를 누르면 휴식으로 빠져요 — 조합 선택·게임 추천에서 제외되고, 쉬는 동안도 대기 시간에 들어가서, 복귀하면 기다린 시간이 이어져요. 명단 줄의 [⋯] → 휴식·복귀로 운영진이 대신 처리할 수도 있어요.',
    ],
  },
  {
    title: '입장 코드',
    items: [
      '모임원은 본인 화면(/m) 링크로 들어와 [내 폰 연결하기] → 코드 4자리 입력 → 이름 선택 순서로 폰을 연결해요. 미리 출석 처리돼 있지 않으면 이때 출석까지 돼요.',
      '코드는 소모임 [필독]공지사항의 작성월일 4자리예요 — 모임원이 이미 보는 정보라 따로 공지할 게 없어요. 공지를 새로 올렸으면 [입장 코드] 모달의 [코드 변경]으로 같이 바꿔주세요.',
      '바꾼 코드는 다음 모임에도 그대로 이어져요. 코드를 여러 번 틀리면 그 폰은 잠시 막혀요(무작위 대입 방지).',
      '한 번 들어온 모임원은 다음 모임에도 본인 화면 주소만 열면 돼요. 홈 화면에 추가해두라고 안내해주세요.',
      '모임 전에 참석자를 [출석 추가]로 미리 넣어두면 현장에서는 콕 확인만 하면 돼요. 미리 넣었는데 사정이 생겨 못 오게 되면 콕 확인 대기 줄의 [취소]로 지워요 — 출석 기록 없이 빠져요(퇴장과 달라요).',
      '명단에 없는 사람은 [출석 추가] 안의 [신규 등록]으로 등록해요 — 게스트는 이름·급수·성별만(생년월일 안 받아요), 모임원은 생년월일 포함(모르면 비워 두고 나중에 채워요). 모임원이 스스로 가입하는 경로는 없어요(외부인 가짜 등록 차단).',
      '개인정보 동의는 본인이 처음 코드로 들어올 때 받아요 — 운영진이 대신 체크하지 않아요.',
    ],
  },
  {
    title: '모임원 관리',
    items: [
      '[모임원 관리]에서 명단 조회·등록·수정·정리를 해요. 모임 시작 전 화면에서도 열 수 있어요.',
      '[신규 등록]은 명단에만 추가돼요(출석 안 됨) — 모임 전에 미리 등록해두는 용도예요. 모임 중 지각자는 [출석 추가]의 [신규 등록]으로 등록+출석을 한 번에 하세요.',
      '이름·생년월일·급수·성별·역할(모임장/운영진/모임원)을 고칠 수 있어요. 급수는 게임 추천 품질에 바로 영향을 주니 실제 실력에 맞춰주세요.',
      '역할은 명단 표시용 구분이에요 — 운영 화면 접근 권한은 패스코드 하나로 같아요.',
      '자주 오는 게스트는 수정 화면에서 [모임원으로 바꾸기]할 수 있어요 (생년월일 입력 필요).',
      '삭제는 명단에서만 감춰요 — 지난 기록은 남고 [삭제됨] 탭에서 복구돼요. 진행 중 모임에 출석한 사람은 퇴장 처리가 먼저예요.',
      '[오래 안 온 게스트 정리]로 90일 이상 미출석 게스트를 골라서 한 번에 지울 수 있어요.',
      '본인이 개인정보 삭제를 요청하면 [개인정보 삭제]를 쓰세요 — 이름·생년월일·성별이 지워지고 복구할 수 없어요.',
    ],
  },
  {
    title: '공유 코트 (다른 모임과 번갈아)',
    items: [
      '콕을 걸어 다른 모임과 순서를 나눠 쓰는 코트는 [코트 관리]에서 [공유]를 켜주세요. [코트 관리]는 [게임 중] 구역 제목 옆에 있어요(더보기 메뉴에도 있어요).',
      '공유 코트는 우리 게임이 끝나면 자동으로 [다른 모임 차례]가 돼요 — 상대 게임이 끝나면 코트 카드의 [우리 차례로]를 눌러주세요(앱이 상대 게임을 알 수 없어 이 탭 하나는 필요해요).',
      '다른 모임 차례인 코트엔 배정이 막혀요 — 실수로 코트를 뺏는 걸 방지해요.',
      '연속으로 두 번 치기로 했으면(퐁퐁당) 게임 종료 후 [우리 차례로]를 눌러 이어가면 돼요. 우리 차례를 양보할 땐 [다른 모임 차례로 넘기기].',
    ],
  },
  {
    title: '게임 추천',
    items: [
      '[게임 추천]은 참고용 초안 3종 — 공정성(오래 기다린 순) / 새 조합(오늘 안 만난 사람) / 믹스.',
      '[마이크] AI 명령 — "민수랑 준호 넣어서 남복 짜줘", "3번 코트 끝났어", "민수 휴식", "홍길동 출석"처럼 적으면 미리보기를 보여 주고, [확인]해야 실행돼요(출석은 이름이 정확히 맞는 사람만 바로). 성 없이 이름만 말해도 오늘 출석자 중 한 명이면 알아들어요. 시트의 [🎙 눌러서 말하기]로 말해도 되고, 말이 끝나면 저절로 멈추거나 [말 끝]으로 멈춰요.',
      '한 번에 여러 개를 말해도 돼요 — "3번 코트 끝났고 남복 하나 짜줘"처럼 말하면 미리보기가 차례로 나와요(최대 3개). 하나를 [확인]하면 다음 것으로 넘어가고, 원치 않으면 [건너뛰기].',
      '[마이크]에 상황을 물어봐도 돼요 — "누가 제일 오래 기다렸어?", "민수 오늘 몇 게임 했어?", "아직 0게임인 사람?", "빈 코트 있어?", "몇 명 왔어?", "다음 게임 누구야?", "메모 뭐 있어?", "민수 메모 있어?". 숫자는 지금 현황에서 바로 계산하고, 메모는 적힌 그대로 읽어 줘요(게임 짜기에는 반영되지 않아요).',
      '[마이크] "게스트 홍길동 남자 C급 추가해줘" — 미리보기에서 빠진 성별·급수를 눌러 채우고 [출석]. 같은 이름 게스트가 있으면 새로 만들지 않고 그 사람으로 출석 처리해요. 콕 확인은 명단 맨 위에서 따로 해요.',
      '게임 수는 "온 시간 대비"로 따져요 — 늦게 온 사람이 먼저 온 사람의 판수를 따라잡으려 연달아 추천되지 않고, 온 뒤부터 같은 속도로 돌아가요.',
      '대기시간·게임 수·함께 뛴 조합·성별 구성(남복/여복/혼복)을 점수로 계산해요. 넣을지는 운영진 마음!',
      '종목 탭(남복/여복/혼복/기타 3:1)을 누르면 그 구성으로만 추천해요. 성별 미지정 멤버는 [전체] 탭에서만 나와요.',
    ],
  },
  {
    title: 'AI 출석 (출석 추가 안)',
    items: [
      '[출석 추가] → [AI 출석]에서 소모임 참석 신청 목록 캡처(최대 4장)를 올리면, 명단과 이름이 확실히 맞는 사람만 자동으로 출석 처리해요.',
      '성+이름이 한 명과 정확히 맞을 때만 자동이에요. 동명이인·이름만 적힌 경우는 "이 모임원인가요?" 카드에서 고르고, 별명·못 찾은 사람은 [모임원 찾아 연결]로 이어 주세요.',
      '성 없는 이름("강민")·별명("콕콕이")은 한 번 고르면 기억해서 다음 모임부터 묻지 않고 바로 출석해요. 잘못 연결했으면 [모임원 관리] → 그 사람 수정 화면의 "소모임 이름"에서 지워요.',
      '"97년생 김민수 출석 처리해줘"처럼 문장으로도 돼요. 출석 말고 다른 요청은 처리하지 않아요.',
      '잘못 잡힌 사람은 결과 카드의 이름 옆 ✕로 바로 취소할 수 있어요(콕 확인 전까지).',
    ],
  },
  {
    title: '알림 (호출 · 다시 알림)',
    items: [
      '모임원이 내 상태 화면에서 [게임 알림 받기]를 켜 두면, 조합 등록·코트 배정·교체 투입·콕 확인 때 폰으로 알림이 가요. 화면이 꺼져 있어도 와요.',
      '명단 줄 [⋯] → 호출 = 그 사람에게 "운영진이 찾고 있어요". 코트 카드 [⋯] → 다시 알림 = 그 게임 4명에게 코트 알림을 다시 보내요.',
      '결과가 버튼에 잠깐 떠요 — "N대 전송"이면 보낸 것, "알림 미등록"이면 알림을 안 켠 분이라 직접 불러야 해요. 같은 대상은 30초에 한 번만.',
      '아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요. 알림은 보조 수단이라 늦거나 빠질 수 있어요 — 현장 호명을 대신하진 않아요.',
    ],
  },
  {
    title: '겹침 · 게임 중 배지',
    items: [
      '한 사람이 여러 대기 조합에 들어갈 수 있어요 (잔여 인원을 미리 조합할 때 유용) — 두 곳 이상이면 "겹침" 배지.',
      '명단에는 조합·게임에 든 사람도 늘 보여요(이름 옆에 "조합 2"·"1번 코트"). 그 사람도 골라서 다음 조합에 미리 넣을 수 있어요.',
      '1~3명만 골라 [빈칸 조합]을 누르거나 대기 조합 맨 아래 [+ 새 조합]을 누르면 빈칸이 있는 조합이 생겨요. 빈칸을 눌러 한 명씩 채우고, 이름 옆 ✕로 빼요. 4명이 다 차야 코트에 배정되고 모임원 앱에도 보여요.',
      '태블릿에서는 자석판처럼 끌어서 옮겨요. 명단의 이름을 살짝 길게 누르면 들려요 → [+ 새 조합] 자리에 놓으면 새 조합, 빈칸에 놓으면 채우기, 조합·코트 카드의 사람 위에 놓으면 교체.',
      '대기 조합 카드 제목 옆 ⠿를 잡고 끌어 다른 조합 위에 놓으면 그 순서로 바뀌고(폰도 돼요), 빈 코트에 놓으면 배정돼요(4명 다 찬 조합만).',
      '대기 조합 카드의 사람을 끌어 다른 조합에 놓으면 옮겨지고, 명단 쪽에 놓으면 그 조합에서 빠져요. 게임 중인 코트의 사람은 끌어낼 수 없어요(교체만).',
      '조합에 게임 중인 사람이 있으면 그 게임이 끝날 때까지 코트 배정이 잠겨요.',
    ],
  },
  {
    title: '잠금 vs 모임 종료',
    items: [
      '[잠금] = 운영 화면 로그아웃만. 모임은 그대로 유지돼요.',
      '[모임 종료] = 그날 마감 — 진행 중 게임 정리 · 전원 퇴장 · 코트 해제 후 마무리 카톡 문구가 떠요. 문구 창을 닫으면 로그아웃돼요. 두 번 눌러야 실행.',
    ],
  },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      ariaLabel="운영 도움말"
      onClose={onClose}
      width="sm:max-w-lg"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">운영 도움말</h2>}
    >
      <div className="min-h-0 flex-1 space-y-4 scroll-area">
        {HELP_SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="text-sm font-bold text-amber">{section.title}</h3>
            <ul className="mt-1.5 space-y-1.5">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed text-dim">
                  <span className="shrink-0 text-faint">·</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

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
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
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

// ===== 코트 관리 =====

function CourtsManager({
  sessionId,
  courts,
  playingByCourt,
  run,
  onClose,
}: {
  sessionId: string;
  courts: ICourt[];
  playingByCourt: Map<string, IGame>;
  run: (a: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [courtNo, setCourtNo] = useState('');

  const add = () => {
    const no = Number(courtNo);
    if (!no) return;
    void run(async () => {
      await api(`/sessions/${sessionId}/courts`, {
        method: 'POST',
        admin: true,
        body: { courtNo: no },
      });
      setCourtNo('');
    });
  };

  return (
    <Sheet
      ariaLabel="코트 관리"
      onClose={onClose}
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">코트 관리</h2>}
      footer={
        <div className="flex gap-2">
          <input
            autoComplete="off"
            inputMode="numeric"
            enterKeyHint="done"
            value={courtNo}
            onChange={(e) => setCourtNo(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="코트 번호"
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
          />
          <button onClick={add} disabled={!courtNo} className="h-11 rounded-xl bg-court px-5 text-sm font-bold text-bg disabled:opacity-50">
            추가
          </button>
        </div>
      }
    >
      {courts.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">오늘 쓰는 코트 번호를 아래에서 추가해주세요</p>
      )}
      {courts.map((court) => {
        const inGame = playingByCourt.has(court.id);
        return (
          <div
            key={court.id}
            className="flex items-center gap-2 rounded-xl bg-panel2 p-3"
          >
            <span className="font-bold">{court.courtNo}번 코트</span>
            {inGame && <span className="text-xs text-court">게임 중</span>}
            {/* 공유 토글 — 다른 모임과 콕 걸고 번갈아 쓰는 코트. 게임 중에도 전환 가능(치는 도중 공유가 시작되기도) */}
            <button
              onClick={() =>
                void run(() =>
                  api(`/courts/${court.id}/shared`, {
                    method: 'PATCH',
                    admin: true,
                    body: { isShared: !court.isShared },
                  }),
                )
              }
              title="다른 모임과 번갈아 쓰는 코트 지정/해제"
              className={`ml-auto h-9 rounded-lg border px-3 text-xs font-medium ${
                court.isShared ? 'border-sky/50 bg-sky/15 text-sky' : 'border-line text-dim'
              }`}
            >
              {court.isShared ? '공유 중' : '공유'}
            </button>
            <button
              onClick={() => void run(() => api(`/courts/${court.id}`, { method: 'DELETE', admin: true }))}
              disabled={inGame}
              title={inGame ? '게임 진행 중' : '코트 해제'}
              className="h-9 rounded-lg bg-panel2 px-3 text-xs text-dim disabled:opacity-30"
            >
              해제
            </button>
          </div>
        );
      })}
    </Sheet>
  );
}

// 코트 고르기 — 빈 코트가 둘 이상일 때 [코트 배정]에서 열린다. 상대 차례인 공유 코트는 이유와 함께 비활성
function CourtPickSheet({
  game,
  idleCourts,
  run,
  onClose,
}: {
  game: IGame;
  idleCourts: ICourt[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const names = (game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean);
  return (
    <Sheet
      ariaLabel="코트 고르기"
      onClose={onClose}
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-amber">몇 번 코트에 넣을까요?</h2>}
    >
      <p className="text-sm text-dim">{names.join(', ')}</p>
      <div className="grid grid-cols-2 gap-2">
        {idleCourts.map((court) => {
          const theirTurn = court.isShared && !court.ourTurn;
          return (
            <button
              key={court.id}
              onClick={() =>
                void run(async () => {
                  await api(`/games/${game.id}/assign`, {
                    method: 'PATCH',
                    admin: true,
                    body: { courtId: court.id },
                  });
                  onClose();
                })
              }
              disabled={theirTurn}
              className="flex h-16 flex-col items-center justify-center rounded-xl bg-amber text-lg font-bold text-bg disabled:bg-panel2 disabled:text-faint"
            >
              {court.courtNo}번 코트
              {theirTurn && <span className="text-caption font-medium">다른 모임 차례</span>}
            </button>
          );
        })}
      </div>
    </Sheet>
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
  onMore,
  dragEnabled,
}: {
  court: ICourt;
  game?: IGame;
  now: number;
  run: (a: () => Promise<unknown>) => Promise<void>;
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
    run(() =>
      api(`/courts/${court.id}/turn`, { method: 'PATCH', admin: true, body: { ourTurn } }),
    );

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
      <BoardSlots game={game} run={run} dragEnabled={dragEnabled} />
      {/* 자주 쓰는 둘만 펼치고(게임 종료·대기로) 나머지(다시 알림·교체·취소)는 [⋯] 시트 */}
      <div className="mt-3 flex gap-1.5">
        <button
          onClick={() => void run(() => api(`/games/${game.id}/finish`, { method: 'PATCH', admin: true }))}
          className="h-10 flex-1 rounded-[10px] bg-court text-body-sm font-bold text-bg"
        >
          게임 종료
        </button>
        <button
          onClick={() => void run(() => api(`/games/${game.id}/unassign`, { method: 'PATCH', admin: true }))}
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
// 비어 있는 사람 → 조합에 든 사람 → 게임 중 → 휴식 (각 묶음 안은 스냅샷 순서 = 오래 기다린 순)
const ROLE_RANK: Record<string, number> = { LEADER: 0, MANAGER: 1 };
const roleRank = (a: IAttendance) => ROLE_RANK[a.member?.role ?? 'MEMBER'] ?? 2;
const ROSTER_RANK: Partial<Record<IAttendance['status'], number>> = {
  CHECKED_IN: 0,
  MATCHED: 1,
  PLAYING: 2,
  RESTING: 3,
};
function sortRoster(attendances: IAttendance[]): IAttendance[] {
  return attendances
    .filter((a) => a.shuttleConfirmedAt && ROSTER_RANK[a.status] !== undefined)
    .sort((a, b) => roleRank(a) - roleRank(b) || ROSTER_RANK[a.status]! - ROSTER_RANK[b.status]!);
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
  run,
  dragEnabled,
  onFillSlot,
}: {
  game: IGame;
  overlapIds?: Set<string>;
  run: (a: () => Promise<unknown>) => Promise<void>;
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
    void run(() => api(`/games/${game.id}/slots`, { method: 'PATCH', admin: true, body: { attendanceId, slot } }));
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
          run={run}
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
  run,
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
  run: (a: () => Promise<unknown>) => Promise<void>;
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
        <span className="min-w-0 truncate rounded bg-court/15 px-1 py-0.5 text-caption font-medium text-court">게임 중</span>
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
            void run(() => api(`/games/${game.id}/players/${player.attendanceId}`, { method: 'DELETE', admin: true }));
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
  run,
  busy,
  onCreated,
  onClose,
}: {
  sessionId: string;
  game: IGame | null;
  roster: IAttendance[];
  placeLabels: Map<string, string>;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onCreated: (game: IGame) => void;
  onClose: () => void;
}) {
  const inGame = new Set((game?.players ?? []).map((p) => p.attendanceId));
  const candidates = roster.filter((a) => a.status !== 'RESTING' && !inGame.has(a.id));
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
      {game && (
        <p className="truncate text-sm text-dim">
          지금: {(game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean).join(', ')}
        </p>
      )}
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
            <GenderMarker gender={member.gender} />
            {member.isGuest && <span className="shrink-0 text-caption text-sky">G</span>}
            {place && (
              <span
                className={`min-w-0 truncate rounded px-1.5 py-0.5 text-caption font-medium ${
                  attendance.status === 'PLAYING' ? 'bg-court/15 text-court' : 'bg-amber/15 text-amber'
                }`}
              >
                {place}
              </span>
            )}
            <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
              {attendance.gamesPlayed}게임
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
  onMore,
  onPickCourt,
  onFillSlot,
  dragEnabled,
}: {
  game: IGame;
  order: number;
  neighborUp?: IGame;
  neighborDown?: IGame;
  idleCourts: ICourt[];
  overlapIds: Set<string>;
  run: (a: () => Promise<unknown>) => Promise<void>;
  onMore: (game: IGame) => void; // [⋯] — 교체·해체 시트(4명 조합)
  onPickCourt: (game: IGame) => void; // 빈 코트가 여럿이면 코트 고르기 시트
  onFillSlot: (game: IGame) => void; // 빈칸 → 사람 고르기 시트
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

  // 순서 변경 = 이웃 조합과 queueOrder 맞교환
  const swapWith = (neighbor?: IGame) => {
    if (!neighbor || game.queueOrder === null || neighbor.queueOrder === null) return;
    void run(async () => {
      await api(`/games/${game.id}/order`, {
        method: 'PATCH',
        admin: true,
        body: { queueOrder: neighbor.queueOrder },
      });
      await api(`/games/${neighbor.id}/order`, {
        method: 'PATCH',
        admin: true,
        body: { queueOrder: game.queueOrder },
      });
    });
  };

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
            onClick={() => swapWith(neighborUp)}
            disabled={!neighborUp}
            aria-label="위로"
            className="tap h-8 w-8 rounded-lg bg-panel text-dim disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={() => swapWith(neighborDown)}
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
        run={run}
        dragEnabled={dragEnabled}
        onFillSlot={() => onFillSlot(game)}
      />
      {/* 4명 조합: 배정 + [⋯](교체·해체) / 빈칸 조합: 할 일이 해체뿐이라 바로 둔다 */}
      <div className="mt-3 flex gap-1.5">
        {!full ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-[10px] bg-panel px-2 text-center text-caption text-faint">
            {GAME_SIZE - (game.players?.length ?? 0)}명 더 필요
          </span>
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
            onClick={() =>
              void run(() =>
                api(`/games/${game.id}/assign`, {
                  method: 'PATCH',
                  admin: true,
                  body: { courtId: available[0].id },
                }),
              )
            }
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
            onConfirm={() => void run(() => api(`/games/${game.id}/cancel`, { method: 'PATCH', admin: true }))}
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
}: {
  attendance: IAttendance;
  run: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard className="flex min-h-11 items-center gap-2 rounded-[10px] bg-amber/10 py-1.5 pr-1.5 pl-2.5 text-body-sm transition-colors">
      <GradeBadge grade={member.grade} />
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
        onClick={() =>
          void run(() =>
            api(`/attendances/${attendance.id}/shuttle`, { method: 'PATCH', admin: true }),
          )
        }
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
  run: (a: () => Promise<unknown>) => Promise<void>;
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
            busyStatus === 'PLAYING' ? 'bg-court/15 text-court' : 'bg-amber/15 text-amber'
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
        {attendance.gamesPlayed}게임 · {formatWaitingMinutes(attendance.waitingSince, now)}
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

// 소모임 이름 — AI 출석에서 기억한 표기("강민"·"콕콕이"). 잘못 연결됐으면 지우고, 미리 알면 직접 추가
function AliasEditor({ memberId }: { memberId: string }) {
  const [aliases, setAliases] = useState<IMemberAlias[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<IMemberAlias[]>(`/members/${memberId}/aliases`, { admin: true })
      .then(setAliases)
      .catch(() => setAliases([]));
  }, [memberId]);

  const call = async (request: () => Promise<IMemberAlias[]>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setAliases(await request());
      setDraft('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const alias = draft.trim();
    if (!alias) return;
    void call(() => api<IMemberAlias[]>(`/members/${memberId}/aliases`, { method: 'POST', admin: true, body: { alias } }));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-bold text-dim">소모임 이름</span>
      <p className="text-caption text-faint">AI 출석이 이 이름을 보면 묻지 않고 바로 이 모임원으로 출석해요</p>
      {aliases && aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {aliases.map((a) => (
            <span key={a.id} className="flex h-9 items-center gap-1 rounded-lg bg-panel2 pr-1 pl-3 text-body-sm">
              {a.alias}
              <button
                onClick={() =>
                  void call(() => api<IMemberAlias[]>(`/members/${memberId}/aliases/${a.id}`, { method: 'DELETE', admin: true }))
                }
                disabled={busy}
                aria-label={`소모임 이름 ${a.alias} 지우기`}
                className="tap flex h-7 w-7 items-center justify-center rounded text-dim hover:text-coral"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <ClearableInput
          autoComplete="off"
          aria-label="소모임 이름 추가"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          maxLength={30}
          placeholder="예: 강민, 콕콕이"
          className="h-11 rounded-xl border-2 border-transparent bg-panel2 px-3 text-body-sm outline-none focus:border-court"
          onClear={() => setDraft('')}
          wrapperClassName="min-w-0 flex-1"
        />
        <button
          onClick={add}
          disabled={busy || !draft.trim()}
          className="tap h-11 shrink-0 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-court disabled:opacity-40"
        >
          추가
        </button>
      </div>
      {error && <p className="text-caption text-coral">{error}</p>}
    </div>
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
  onClose,
}: {
  game: IGame;
  title: string;
  run: (a: () => Promise<unknown>) => Promise<void>;
  onReplace: (game: IGame) => void;
  onClose: () => void;
}) {
  const playing = game.status === 'PLAYING';
  const names = (game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean).join(', ');
  const cancel = () =>
    void run(async () => {
      await api(`/games/${game.id}/cancel`, { method: 'PATCH', admin: true });
      onClose();
    });
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
  run: (a: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const member = attendance.member;
  const resting = attendance.status === 'RESTING';
  const busy = attendance.status === 'PLAYING' || attendance.status === 'MATCHED'; // 게임 중·조합에 든 사람은 호출만
  const act = (path: string, admin: boolean) =>
    void run(async () => {
      await api(`/attendances/${attendance.id}/${path}`, { method: 'PATCH', ...(admin && { admin: true }) });
      onClose();
    });
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
