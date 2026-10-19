'use client';

import { GAME_SIZE, IFillCourtsResult, IGame, IGameRecommendation, ISessionSnapshot } from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { LoginGate, useAdminAuth } from '@/components/admin-gate';
import { BirthdayCalendarModal } from '@/components/birthday-calendar';
import {
  BoardDnd,
  TEMP_GAME_PREFIX,
  useBoardDragEnabled,
  type DragItem,
  type DropTarget,
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
import { Toast } from '@/components/badges';
import { HomeLink } from '@/components/home-link';
import { InstallPrompt } from '@/components/install-prompt';
import { LogoLoader } from '@/components/logo-loader';
import { api, ApiError } from '@/lib/api';
import { useSnapshot } from '@/lib/use-snapshot';
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
import { Empty, Zone } from '@/components/admin/board-ui';
import { ConfirmButton } from '@/components/confirm-button';
import {
  ROSTER_SORT_KEY,
  RosterSort,
  RosterSortSelect,
  readRosterSort,
  sortCandidates,
  sortRoster,
} from '@/components/admin/roster-sort';
import { NewGameSlot, RosterDrop, buildPlaceLabels, isFullGame } from '@/components/admin/board-slots';
import { CourtCard } from '@/components/admin/court-card';
import { QueueCard } from '@/components/admin/queue-card';
import { ShuttleRow, WaitingRow } from '@/components/admin/waiting-rows';
import {
  GameActionSheet,
  ReplacePlayerModal,
  SlotFillSheet,
  WaitingActionSheet,
  type AttendanceChange,
} from '@/components/admin/action-sheets';
import { StartScreen } from '@/components/admin/start-screen';

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
type GamePlayer = NonNullable<IGame['players']>[number];
const playersSignature = (players: GamePlayer[] = []) =>
  players.map((p) => `${p.attendanceId}:${p.slot}`).sort().join(',');
type OptimisticGame = { game: IGame; ids: string[]; realId?: string };
// 조합의 첫 빈자리(0~3) — 서버 pickFreeSlot과 같은 규칙
const firstFreeSlot = (players: GamePlayer[]) => [0, 1, 2, 3].find((n) => !players.some((p) => p.slot === n));

// 서버 화면에 같은 조합이 실렸는지 — 같은 4명 조합은 서버가 중복으로 막아서 사람 묶음으로 알아볼 수 있다
function isSettled(t: OptimisticGame, games: IGame[]): boolean {
  return games.some((g) => {
    const ids = (g.players ?? []).map((p) => p.attendanceId);
    if (g.id === t.realId) return ids.length >= t.ids.length;
    return g.status === 'QUEUED' && ids.length === t.ids.length && t.ids.every((id) => ids.includes(id));
  });
}

// ===== 누르자마자 반영 — 서버 화면 위에 아직 서버에 닿지 않은 조작을 서버 규칙대로 덧씌운다(상태 없는 계산만) =====

type OptimisticBoard = {
  optAssign: Map<string, { courtId: string; startedAt: string }>; // 코트 배정
  optCreated: OptimisticGame[]; // 새 조합
  optEnded: Map<string, { kind: 'FINISHED' | 'UNASSIGNED'; at: string }>; // 게임 종료·대기로
  optPlayers: Map<string, { players: GamePlayer[]; base: string; pending: number }>; // 조합 안 사람 바꾸기
};

function overlayGames(serverGames: IGame[], { optAssign, optCreated, optEnded, optPlayers }: OptimisticBoard): IGame[] {
  if (optAssign.size === 0 && optCreated.length === 0 && optEnded.size === 0 && optPlayers.size === 0) return serverGames;
  const pending = optCreated.filter((t) => !isSettled(t, serverGames));
  // 대기로 돌린 조합은 서버처럼 대기 조합 맨 뒤
  let lastOrder = Math.max(0, ...serverGames.map((g) => (g.status === 'QUEUED' ? (g.queueOrder ?? 0) : 0)));
  const base = serverGames
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
}

function overlayAttendances(
  serverAttendances: ISessionSnapshot['attendances'],
  serverGames: IGame[],
  games: IGame[], // overlayGames 결과
  { optAssign, optCreated, optEnded, optPlayers }: OptimisticBoard,
): ISessionSnapshot['attendances'] {
  if (optAssign.size === 0 && optCreated.length === 0 && optEnded.size === 0 && optPlayers.size === 0) return serverAttendances;
  const playing = new Set(
    games.filter((g) => optAssign.has(g.id)).flatMap((g) => (g.players ?? []).map((p) => p.attendanceId)),
  );
  const matched = new Set(optCreated.flatMap((t) => t.ids));
  // 종료: 전원 대기 시간 리셋 + 게임 수 +1, 다른 조합에 들어 있으면 '대기 조합', 아니면 대기로(서버 finish와 같은 규칙)
  // 대기로: 조합이 그대로 대기 조합에 남으니 전원 '대기 조합'
  const finished = new Map<string, string>();
  const unassigned = new Set<string>();
  for (const g of serverGames) {
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
  // 다른 카드에서 옮겨 넣은 사람 — 게임 중 카드면 '게임 중', 대기 조합이면 대기였던 사람만 '대기 조합'
  const removed = new Set<string>();
  const removedFromPlaying = new Set<string>(); // 게임 중 카드에서 교체로 빠진 사람
  const added = new Map<string, 'PLAYING' | 'MATCHED'>();
  for (const [id, patch] of optPlayers) {
    const kept = new Set(patch.players.map((p) => p.attendanceId));
    const server = serverGames.find((g) => g.id === id);
    const before = new Set((server?.players ?? []).map((p) => p.attendanceId));
    for (const p of server?.players ?? []) {
      if (kept.has(p.attendanceId)) continue;
      removed.add(p.attendanceId);
      if (server?.status === 'PLAYING') removedFromPlaying.add(p.attendanceId);
    }
    for (const p of patch.players) if (!before.has(p.attendanceId)) added.set(p.attendanceId, server?.status === 'PLAYING' ? 'PLAYING' : 'MATCHED');
  }
  return serverAttendances.map((a) => {
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
    const addedAs = added.get(a.id);
    if (addedAs === 'PLAYING' || (addedAs && a.status === 'CHECKED_IN')) return { ...a, status: addedAs };
    if (removedFromPlaying.has(a.id)) return { ...a, status: inOtherGame.has(a.id) ? ('MATCHED' as const) : ('CHECKED_IN' as const) };
    if (removed.has(a.id) && a.status === 'MATCHED' && !inOtherGame.has(a.id)) return { ...a, status: 'CHECKED_IN' as const };
    return a.status === 'CHECKED_IN' && matched.has(a.id) ? { ...a, status: 'MATCHED' as const } : a;
  });
}

// 종료한 공유 코트는 서버처럼 '다른 모임 차례'로, [우리 차례로]·[넘기기]는 누른 값으로
function overlayCourts(
  serverCourts: ISessionSnapshot['courts'],
  serverGames: IGame[],
  optEnded: OptimisticBoard['optEnded'],
  optTurn: Map<string, boolean>,
): ISessionSnapshot['courts'] {
  if (optEnded.size === 0 && optTurn.size === 0) return serverCourts;
  const yielded = new Set(
    serverGames.filter((g) => g.status === 'PLAYING' && optEnded.get(g.id)?.kind === 'FINISHED').map((g) => g.courtId),
  );
  return serverCourts.map((c) => {
    const turn = optTurn.get(c.id);
    if (turn !== undefined) return { ...c, ourTurn: turn };
    return c.isShared && yielded.has(c.id) ? { ...c, ourTurn: false } : c;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courtsOpen, setCourtsOpen] = useState(false);
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
  const [slotTarget, setSlotTarget] = useState<{ gameId: string | null } | null>(null);

  const { session } = snapshot;
  const dragEnabled = useBoardDragEnabled(); // 태블릿 이상 — 자석판처럼 끌어다 놓기

  // 코트 배정·조합 만들기는 누르자마자 보여 준다 — 서버 응답과 화면 새로고침(두 번 오감)을 기다리면 멈춘 것처럼 보였다.
  // 서버 화면에 실리면 이 표시는 지우고, 실패하면 되돌린다(알림은 runParallel)
  const [optAssign, setOptAssign] = useState<OptimisticBoard['optAssign']>(new Map());
  const [optCreated, setOptCreated] = useState<OptimisticGame[]>([]);
  // 조합 안 사람 빼기·자리 바꾸기 — 바뀐 사람 목록을 대신 보여 준다. base=처음 누를 때 서버 목록, pending=아직 안 끝난 요청 수
  // 요청이 다 끝났고 서버 목록이 base와 달라지면(반영됨) 지운다 — 연달아 누르는 중엔 지우지 않아 앞 단계로 깜빡이지 않게
  const [optPlayers, setOptPlayers] = useState<OptimisticBoard['optPlayers']>(new Map());
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
  const [optEnded, setOptEnded] = useState<OptimisticBoard['optEnded']>(new Map());
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
  const games = useMemo(
    () => overlayGames(snapshot.games, { optAssign, optCreated, optEnded, optPlayers }),
    [snapshot.games, optAssign, optCreated, optEnded, optPlayers],
  );
  const attendances = useMemo(
    () => overlayAttendances(snapshot.attendances, snapshot.games, games, { optAssign, optCreated, optEnded, optPlayers }),
    [snapshot.attendances, snapshot.games, games, optAssign, optCreated, optEnded, optPlayers],
  );
  // 공유 코트 [우리 차례로]·[넘기기]도 누르자마자 — 서버 화면이 같아지면 지우고, 실패하면 되돌린다
  const [optTurn, setOptTurn] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    setOptTurn((prev) => {
      const next = new Map([...prev].filter(([id, ourTurn]) => {
        const court = snapshot.courts.find((c) => c.id === id);
        return court !== undefined && court.ourTurn !== ourTurn;
      }));
      return next.size === prev.size ? prev : next;
    });
  }, [snapshot.courts]);
  const courts = useMemo(
    () => overlayCourts(snapshot.courts, snapshot.games, optEnded, optTurn),
    [snapshot.courts, snapshot.games, optEnded, optTurn],
  );
  const setCourtTurn = useCallback(
    (courtId: string, ourTurn: boolean) => {
      setOptTurn((prev) => new Map(prev).set(courtId, ourTurn));
      void runParallel(() => api(`/courts/${courtId}/turn`, { method: 'PATCH', admin: true, body: { ourTurn } })).then((ok) => {
        if (ok) return;
        setOptTurn((prev) => {
          const next = new Map(prev);
          next.delete(courtId); // 실패 — 서버 화면대로(알림은 runParallel)
          return next;
        });
      });
    },
    [runParallel],
  );
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
  // 카드 사람 목록을 먼저 바꿔 보여 주고 요청을 보낸다 — 카드끼리 옮길 때는 두 카드를 함께(요청 안에서 넣기 → 빼기 차례로)
  // 실패하면 바꾼 카드 모두 서버 화면대로. 결과(성공 여부)를 돌려줘 이어서 할 일을 정할 수 있게
  const patchGames = useCallback(
    (changes: [string, (players: GamePlayer[]) => GamePlayer[]][], request: () => Promise<unknown>) => {
      const ready = changes.every(
        ([gameId]) =>
          !gameId.startsWith(TEMP_GAME_PREFIX) &&
          snapshot.games.some((g) => g.id === gameId) &&
          gamesRef.current.some((g) => g.id === gameId),
      );
      if (!ready) return Promise.resolve(false);
      const ids = changes.map(([gameId]) => gameId);
      const patched = changes.map(([gameId, change]) => ({
        gameId,
        players: change(gamesRef.current.find((g) => g.id === gameId)?.players ?? []),
        base: playersSignature(snapshot.games.find((g) => g.id === gameId)?.players),
      }));
      setOptPlayers((prev) => {
        const next = new Map(prev);
        for (const { gameId, players, base } of patched) {
          const old = prev.get(gameId);
          next.set(gameId, { players, base: old?.base ?? base, pending: (old?.pending ?? 0) + 1 });
        }
        return next;
      });
      return runParallel(request).then((ok) => {
        setOptPlayers((prev) => {
          const next = new Map(prev);
          for (const gameId of ids) {
            const patch = prev.get(gameId);
            if (!patch) continue;
            if (!ok) next.delete(gameId); // 실패 — 서버 화면대로(알림은 runParallel)
            else next.set(gameId, { ...patch, pending: patch.pending - 1 });
          }
          return next;
        });
        // 서버 목록이 결국 처음과 같아졌으면(바꿨다 되돌림) 지울 계기가 없다 — 새로고침이 올 만큼 기다렸다 지운다
        setTimeout(
          () =>
            setOptPlayers((prev) => {
              const done = ids.filter((gameId) => prev.get(gameId)?.pending === 0);
              if (done.length === 0) return prev;
              const next = new Map(prev);
              done.forEach((gameId) => next.delete(gameId));
              return next;
            }),
          2000,
        );
        return ok;
      });
    },
    [snapshot.games, runParallel],
  );
  const patchPlayers = useCallback(
    (gameId: string, change: (players: GamePlayer[]) => GamePlayer[], request: () => Promise<unknown>) =>
      void patchGames([[gameId, change]], request),
    [patchGames],
  );
  // 선수 교체 — 나간 사람 자리에 들어온 사람을 바로 보여 준다(서버 replacePlayer와 같은 자리 규칙, 끌어서 교체와 같은 API)
  const replacePlayer = useCallback(
    (gameId: string, outAttendanceId: string, inAttendanceId: string) => {
      const attendance = snapshot.attendances.find((a) => a.id === inAttendanceId);
      void patchGames(
        [
          [
            gameId,
            (players) =>
              players.map((p) =>
                p.attendanceId === outAttendanceId
                  ? { ...p, id: `${TEMP_GAME_PREFIX}${inAttendanceId}`, attendanceId: inAttendanceId, attendance }
                  : p,
              ),
          ],
        ],
        () => api(`/games/${gameId}/players`, { method: 'PATCH', admin: true, body: { outAttendanceId, inAttendanceId } }),
      );
    },
    [snapshot.attendances, patchGames],
  );
  // 게임 취소·조합 해체 — 사람을 다 뺀 모습(서버처럼 해체)으로 바로 보여 준다. 사람은 다른 조합에 없으면 대기로, 코트는 빈다
  const cancelGame = useCallback(
    (gameId: string) =>
      void patchGames([[gameId, () => []]], () => api(`/games/${gameId}/cancel`, { method: 'PATCH', admin: true })),
    [patchGames],
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
  // 새 조합을 대기 조합 맨 끝에 바로 보여 주고 서버에 보낸다([조합 만들기]·새 조합 자리로 끌기 공용)
  // removeFrom = 다른 카드에서 끌어온 사람 — 만든 뒤 그 카드에서 뺀다(그 카드도 바로 빠진 모습으로)
  // 임시 조합 → 서버 조합 id(만들어지면). 빈칸 채우기에서 만드는 중인 조합에 이어서 넣을 때 기다린다
  const tempReal = useRef(new Map<string, Promise<string | null>>());
  const startGame = useCallback(
    (ids: string[], removeFrom?: string) => {
      // 원래 카드가 그 사이 해체됐으면 뺄 곳이 없다 — 만들기만
      const origin = removeFrom && snapshot.games.some((g) => g.id === removeFrom) ? removeFrom : undefined;
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
      let resolveReal: (id: string | null) => void = () => {};
      tempReal.current.set(tempId, new Promise((resolve) => (resolveReal = resolve)));
      const request = async () => {
        try {
          if (ids.length === GAME_SIZE) {
            await api(`/sessions/${session.id}/games`, { method: 'POST', admin: true, body: { attendanceIds: ids } });
            resolveReal(null);
          } else {
            const draft = await api<IGame>(`/sessions/${session.id}/games/draft`, {
              method: 'POST',
              admin: true,
              body: { attendanceId: ids[0] },
            });
            resolveReal(draft.id);
            setOptCreated((prev) => prev.map((t) => (t.game.id === tempId ? { ...t, realId: draft.id } : t)));
            for (const attendanceId of ids.slice(1)) {
              await api(`/games/${draft.id}/players`, { method: 'POST', admin: true, body: { attendanceId } });
            }
          }
        } catch (error) {
          resolveReal(null);
          drop(); // 실패 — 대기로 되돌린다(빈칸 조합이 일부만 만들어졌으면 그 조합이 서버 화면대로 남는다)
          throw error;
        }
        setTimeout(drop, 5000); // 실시간 화면을 못 받아도 새로고침으로 실린 뒤엔 대신 보여 주던 것을 버린다
        if (origin) {
          await api(`/games/${origin}/players/${ids[0]}`, { method: 'DELETE', admin: true });
        }
      };
      if (origin) {
        void patchGames([[origin, (players) => players.filter((p) => p.attendanceId !== ids[0])]], request);
      } else {
        void runParallel(request);
      }
      return tempId;
    },
    [session.id, snapshot.attendances, snapshot.games, patchGames, runParallel],
  );
  // 만드는 중인 조합에 한 명 더 — 임시 카드에 바로 붙이고, 서버 조합이 생기면 그 조합에 넣는다. 실패하면 임시 카드에서 뺀다
  const growTemp = useCallback(
    (tempId: string, attendanceId: string) => {
      const attendance = snapshot.attendances.find((a) => a.id === attendanceId);
      setOptCreated((prev) =>
        prev.map((t) => {
          if (t.game.id !== tempId || t.ids.includes(attendanceId)) return t;
          const slot = firstFreeSlot(t.game.players ?? []);
          if (slot === undefined) return t;
          const player = { id: `${tempId}:${slot}`, gameId: tempId, attendanceId, slot, attendance };
          return { ...t, ids: [...t.ids, attendanceId], game: { ...t.game, players: [...(t.game.players ?? []), player] } };
        }),
      );
      void runParallel(async () => {
        const realId = await tempReal.current.get(tempId);
        if (!realId) throw new Error('조합을 만들지 못해 넣지 못했어요');
        await api(`/games/${realId}/players`, { method: 'POST', admin: true, body: { attendanceId } });
      }).then((ok) => {
        if (ok) return;
        setOptCreated((prev) =>
          prev.map((t) =>
            t.game.id === tempId
              ? {
                  ...t,
                  ids: t.ids.filter((id) => id !== attendanceId),
                  game: { ...t.game, players: (t.game.players ?? []).filter((p) => p.attendanceId !== attendanceId) },
                }
              : t,
          ),
        );
      });
    },
    [snapshot.attendances, runParallel],
  );
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
      // 끌어온 카드가 아직 서버에 없는 조합(만드는 중)이면 뺄 곳이 없다
      const origin = from && !from.startsWith(TEMP_GAME_PREFIX) ? from : undefined;
      const leaveOrigin = () =>
        origin
          ? api(`/games/${origin}/players/${person.attendanceId}`, { method: 'DELETE', admin: true })
          : Promise.resolve();
      // 카드끼리 옮기기 — 놓자마자 새 카드에 들어가고 원래 카드에서 빠진 모습으로. 요청은 넣기 → 빼기 차례로
      const moved: GamePlayer = {
        id: `${TEMP_GAME_PREFIX}${person.attendanceId}`,
        gameId: '',
        attendanceId: person.attendanceId,
        slot: 0,
        attendance: snapshot.attendances.find((a) => a.id === person.attendanceId),
      };
      const withOrigin = (
        targetId: string,
        change: (players: GamePlayer[]) => GamePlayer[],
      ): [string, (players: GamePlayer[]) => GamePlayer[]][] => [
        [targetId, change],
        ...(origin
          ? [[origin, (players: GamePlayer[]) => players.filter((p) => p.attendanceId !== person.attendanceId)] as [
              string,
              (players: GamePlayer[]) => GamePlayer[],
            ]]
          : []),
      ];
      // 아무 데도 아닌 곳·명단 = 카드에서 떼어 내기(명단에서 끈 거면 아무 일 없음)
      if (!target || target.kind === 'roster') {
        if (from) slotActions.removePlayer(from, person.attendanceId);
        return;
      }
      if (target.kind === 'new-game') {
        startGame([person.attendanceId], origin);
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
      if (target.kind === 'court') return; // 사람은 코트 자체엔 못 놓는다
      const targetPlayers = gamesRef.current.find((g) => g.id === target.gameId)?.players ?? [];
      // 이미 그 카드에 있는 사람이면 서버도 막는다 — 바꿔 보여 주지 않는다
      if (targetPlayers.some((p) => p.attendanceId === person.attendanceId)) return;
      if (target.kind === 'player') {
        if (target.attendanceId === person.attendanceId) return;
        void patchGames(
          withOrigin(target.gameId, (players) =>
            players.map((p) => (p.attendanceId === target.attendanceId ? { ...moved, gameId: target.gameId, slot: p.slot } : p)),
          ),
          async () => {
            await api(`/games/${target.gameId}/players`, {
              method: 'PATCH',
              admin: true,
              body: { outAttendanceId: target.attendanceId, inAttendanceId: person.attendanceId },
            });
            await leaveOrigin();
          },
        );
        return;
      }
      // 빈칸 또는 빈칸 있는 카드의 여백 — 같은 카드거나 다 찬 카드면 그대로
      if (target.gameId === from || (target.kind === 'card' && target.full)) return;
      // 빈칸에 놓았으면 그 자리로(팀이 정해진다), 카드 여백이면 첫 빈자리(서버 pickFreeSlot과 같은 규칙)
      const addBody = target.kind === 'slot' ? { ...body, slot: target.slot } : body;
      const used = new Set(targetPlayers.map((p) => p.slot));
      const slot =
        target.kind === 'slot' && !used.has(target.slot)
          ? target.slot
          : [0, 1, 2, 3].find((n) => !used.has(n));
      if (slot === undefined) return;
      void patchGames(
        withOrigin(target.gameId, (players) => [...players, { ...moved, gameId: target.gameId, slot }]),
        async () => {
          await api(`/games/${target.gameId}/players`, { method: 'POST', admin: true, body: addBody });
          await leaveOrigin();
        },
      );
    },
    [snapshot.attendances, queuedGames, assignToCourt, slotActions, startGame, patchGames],
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
  // [빈 코트 채우기]로 들어갈 조합과 코트 — 서버 fillCourts와 같은 규칙(코트 번호순, 공유 코트는 우리 차례만, 게임 중인 사람이 든 조합은 건너뜀)
  const fillPlan = useMemo(() => {
    const free = idleCourts.filter((c) => !c.isShared || c.ourTurn).sort((a, b) => a.courtNo - b.courtNo);
    const busyIds = new Set(attendances.filter((a) => a.status === 'PLAYING').map((a) => a.id));
    const plan: { gameId: string; courtId: string }[] = [];
    for (const game of queuedGames) {
      if (plan.length === free.length) break;
      if (!isFullGame(game) || game.id.startsWith(TEMP_GAME_PREFIX)) continue; // 빈칸 있는 조합은 서버도 건너뛴다, 아직 서버에 없는 조합도
      const ids = (game.players ?? []).map((p) => p.attendanceId);
      if (ids.some((id) => busyIds.has(id))) continue;
      ids.forEach((id) => busyIds.add(id));
      plan.push({ gameId: game.id, courtId: free[plan.length].id });
    }
    return plan;
  }, [idleCourts, queuedGames, attendances]);
  const fillableCount = fillPlan.length;
  const [fillNotice, setFillNotice] = useState<string | null>(null);
  const fillNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (fillNoticeTimer.current) clearTimeout(fillNoticeTimer.current);
  }, []);
  const filling = useRef(false); // 응답 전에 또 누르면 덧씌움만 생기고 요청은 잠금에 막힌다 — 여기서 먼저 막는다
  // 누르자마자 계획대로 코트에 넣어 보여 준다(코트 배정과 같은 덧씌움). 서버가 건너뛴 조합은 응답을 받으면 대기로 되돌리고,
  // 다른 코트에 넣었으면 서버 화면이 오면서 맞춰진다
  const fillCourts = () => {
    const plan = fillPlan;
    if (filling.current || plan.length === 0) return;
    filling.current = true;
    const startedAt = new Date().toISOString();
    setOptAssign((prev) => {
      const next = new Map(prev);
      plan.forEach(({ gameId, courtId }) => next.set(gameId, { courtId, startedAt }));
      return next;
    });
    const undo = (gameIds: string[]) =>
      setOptAssign((prev) => {
        const next = new Map(prev);
        gameIds.forEach((id) => next.delete(id));
        return next;
      });
    void run(async () => {
      let result: IFillCourtsResult;
      try {
        result = await api<IFillCourtsResult>(`/sessions/${session.id}/fill-courts`, {
          method: 'POST',
          admin: true,
        });
      } catch (error) {
        undo(plan.map((p) => p.gameId));
        throw error;
      }
      const assigned = new Set(result.assigned.map((a) => a.gameId));
      undo(plan.filter((p) => !assigned.has(p.gameId)).map((p) => p.gameId));
      // 결과는 구역 안에 몇 초 보여 준다(보드 토스트는 오류 전용 빨간색이라)
      const lines = [
        ...result.assigned.map((a) => `${a.courtNo}번 코트 ← ${a.names[0]} 외 ${a.names.length - 1}명`),
        ...result.skipped.map((s) => `건너뜀: ${s.reason}`),
      ];
      setFillNotice(lines.length > 0 ? lines.join(' · ') : '배정할 조합이 없어요');
      if (fillNoticeTimer.current) clearTimeout(fillNoticeTimer.current);
      fillNoticeTimer.current = setTimeout(() => setFillNotice(null), 5000);
    }, 'fill-courts').finally(() => {
      filling.current = false;
    });
  };

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
  // 대기 줄 [⋯] 휴식·복귀·퇴장·콕 확인 취소도 누르자마자 반영 — 서버 화면이 같아지면 지우고, 실패하면 되돌린다
  const [optAttendance, setOptAttendance] = useState<Map<string, AttendanceChange>>(new Map());
  useEffect(() => {
    setOptAttendance((prev) => {
      const next = new Map([...prev].filter(([id, change]) => {
        const a = attendances.find((x) => x.id === id);
        return a !== undefined && !changeApplied(a, change);
      }));
      return next.size === prev.size ? prev : next;
    });
  }, [attendances]);
  const shuttleView = useMemo(
    () =>
      confirming.size === 0 && optAttendance.size === 0
        ? attendances
        : attendances.map((a) => {
            const at = confirming.get(a.id);
            const confirmed = at && !a.shuttleConfirmedAt ? { ...a, shuttleConfirmedAt: at, waitingSince: at } : a;
            const change = optAttendance.get(a.id);
            return change ? applyChange(confirmed, change) : confirmed;
          }),
    [attendances, confirming, optAttendance],
  );
  const changeAttendance = (attendanceId: string, change: AttendanceChange) => {
    if (optAttendance.has(attendanceId)) return;
    setOptAttendance((prev) => new Map(prev).set(attendanceId, change));
    const admin = change === 'leave' || change === 'shuttle/cancel';
    void runParallel(() =>
      api(`/attendances/${attendanceId}/${change}`, { method: 'PATCH', ...(admin && { admin: true }) }),
    ).then((ok) => {
      if (ok) return;
      setOptAttendance((prev) => {
        const next = new Map(prev);
        next.delete(attendanceId); // 실패 — 서버 화면대로(알림은 runParallel)
        return next;
      });
    });
  };
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
  // 모임장 → 운영진을 맨 위에(현장에서 찾기 쉽게), 나머지는 명단 정렬과 상관없이 항상 이름순 — 콕 낸 사람을 이름으로 찾는다
  const pendingShuttle = useMemo(
    () =>
      sortCandidates(
        shuttleView.filter((a) => a.status !== 'LEFT' && !a.shuttleConfirmedAt),
        'NAME',
      ),
    [shuttleView],
  );
  // 명단 — 콕 확인된 출석자 전원(조합에 넣어도 사라지지 않는 자석판 명단). 운영진 아래는 고른 정렬(기본 대기순: 오래 기다린 사람이 위)
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
  // 빈칸 채우기 대상 — 보이는 화면 기준, 다 차거나 배정·해체되면 시트가 저절로 닫힌다
  // 시트에서 만든 새 조합은 서버 조합이 생기기 전까지 임시 카드로 보이므로 서버 id로도 그 임시 카드를 찾는다
  const slotTempOf = (id: string) => optCreated.find((t) => t.game.id === id || t.realId === id);
  const slotLive = slotTarget?.gameId
    ? (games.find((g) => g.id === slotTarget.gameId) ??
      games.find((g) => g.id === slotTempOf(slotTarget.gameId as string)?.game.id))
    : undefined;
  const slotGame = slotLive && slotLive.status === 'QUEUED' && !isFullGame(slotLive) ? slotLive : null;
  const slotOpen = slotTarget !== null && (slotTarget.gameId === null || slotGame !== null);
  // 서버 조합 id가 생기면 그 id로 바꿔 둔다 — 임시 카드가 사라진 뒤에도 같은 조합을 이어서 채우게
  useEffect(() => {
    const id = slotTarget?.gameId;
    if (!id?.startsWith(TEMP_GAME_PREFIX)) return;
    const realId = optCreated.find((t) => t.game.id === id)?.realId;
    if (realId) setSlotTarget({ gameId: realId });
  }, [slotTarget, optCreated]);
  // 빈칸 채우기에서 사람 고르기 — 누르자마자 그 조합에 들어간 모습으로(새 조합이면 임시 카드부터)
  const fillSlot = (gameId: string | null, attendanceId: string) => {
    if (!gameId) {
      setSlotTarget({ gameId: startGame([attendanceId]) });
      return;
    }
    const temp = slotTempOf(gameId);
    if (temp) {
      growTemp(temp.game.id, attendanceId);
      return;
    }
    const attendance = snapshot.attendances.find((a) => a.id === attendanceId);
    void patchGames(
      [
        [
          gameId,
          (players) => {
            const slot = firstFreeSlot(players);
            if (slot === undefined || players.some((p) => p.attendanceId === attendanceId)) return players;
            return [...players, { id: `${TEMP_GAME_PREFIX}${attendanceId}`, gameId, attendanceId, slot, attendance }];
          },
        ],
      ],
      () => api(`/games/${gameId}/players`, { method: 'POST', admin: true, body: { attendanceId } }),
    );
  };
  // 추천 [대기에 추가]·[빈자리에 넣기] — 누르자마자 대기 조합에 보이게(조합 만들기·빈칸 채우기와 같은 길)
  const addRecommended = (rec: IGameRecommendation, fillGame?: IGame) => {
    const ids = rec.players.map((p) => p.attendanceId);
    if (!fillGame) {
      startGame(ids);
      return;
    }
    const missing = ids.filter((id) => !(fillGame.players ?? []).some((p) => p.attendanceId === id));
    const temp = slotTempOf(fillGame.id);
    if (temp) {
      missing.forEach((id) => growTemp(temp.game.id, id));
      return;
    }
    // 여러 명을 한 번에 그려야 한다 — fillSlot을 사람마다 부르면 같은 빈자리를 두고 앞사람 모습을 덮어쓴다
    void patchGames(
      [
        [
          fillGame.id,
          (players) =>
            missing.reduce((next, attendanceId) => {
              const slot = firstFreeSlot(next);
              if (slot === undefined || next.some((p) => p.attendanceId === attendanceId)) return next;
              const attendance = snapshot.attendances.find((a) => a.id === attendanceId);
              return [...next, { id: `${TEMP_GAME_PREFIX}${attendanceId}`, gameId: fillGame.id, attendanceId, slot, attendance }];
            }, players),
        ],
      ],
      async () => {
        for (const attendanceId of missing) {
          await api(`/games/${fillGame.id}/players`, { method: 'POST', admin: true, body: { attendanceId } });
        }
      },
    );
  };
  const leftCount = shuttleView.filter((a) => a.status === 'LEFT').length;
  const presentCount = shuttleView.length - leftCount;

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
    startGame(ids);
  };

  const closeSession = () => {
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
      // 같은 창으로 — 새 창은 설치된 관제판 앱에서 주소·X가 붙은 임시 브라우저로 열렸다. 앱 영역(/admin) 안이라 그대로 앱 화면에 뜬다
      // 지난 기록과 같은 이유로 시트를 닫지 않고 이동한다(닫으면 뒤로가기 정리가 이동을 되돌린다)
      keepMenuOpen: true,
      onClick: () => router.push('/admin/board'),
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
                onTurn={setCourtTurn}
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
                onClick={fillCourts} // 연타는 fillCourts가 막는다 — 다른 동작이 진행 중이어도 누를 수 있게
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
                onCancel={cancelGame}
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
                className="h-13 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-court"
              >
                게임 추천
              </button>
              <button
                onClick={createGame} // 누르자마자 반영되는 동작이라 다른 요청이 진행 중이어도 막지 않는다
                disabled={selected.size === 0}
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
          <MemoPanel snapshot={snapshot} run={run} />
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
          onAdd={(rec) => addRecommended(rec)}
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
              onAdd={(rec) => addRecommended(rec, fillGame)}
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
          // 확인 창에서 고른 코트로 게임 중 — 기록을 닫고 코트에서 바로 보이게. 안 되면 서버가 이유를 알려 준다
          onReopen={(game, court) => {
            setGamesLogOpen(false);
            void run(async () => {
              await api(`/games/${game.id}/reopen`, { method: 'PATCH', admin: true, body: { courtId: court.id } });
              showToast(`#${game.no} 게임을 ${court.courtNo}번 코트 게임 중으로 되돌렸어요`, 'success');
            }, `game:${game.id}`);
          }}
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
            {/* 2탭 확인 — 첫 탭은 문구만 바뀌고 시트는 그대로 */}
            <ConfirmButton
              label="모임 종료"
              confirmLabel="한 번 더 누르면 모임이 종료돼요"
              onConfirm={closeSession}
              className="flex h-13 items-center px-4 text-left text-body font-bold"
              idleCls="text-coral"
              armedCls="bg-coral/15 text-coral"
            />
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
          onCancel={cancelGame}
          onReplace={(g) => setReplaceGameId(g.id)}
          onMoveCourt={(g) => setMoveGameId(g.id)}
          onClose={() => setCardMenuId(null)}
        />
      )}
      {actionTarget && (
        <WaitingActionSheet
          attendance={actionTarget}
          onChange={(change) => changeAttendance(actionTarget.id, change)}
          onClose={() => setActionId(null)}
        />
      )}
      {slotOpen && (
        <SlotFillSheet
          game={slotGame}
          roster={roster}
          placeLabels={placeLabels}
          sort={rosterSort}
          onSort={setRosterSort}
          onPick={(attendanceId) => fillSlot(slotGame?.id ?? null, attendanceId)}
          onClose={() => setSlotTarget(null)}
        />
      )}
      {replaceTarget && (
        <ReplacePlayerModal
          game={replaceTarget}
          attendances={attendances}
          sort={rosterSort}
          onSort={setRosterSort}
          placeLabels={placeLabels}
          onReplace={(outId, inId) => replacePlayer(replaceTarget.id, outId, inId)}
          onClose={() => setReplaceGameId(null)}
        />
      )}
      {toast && <Toast toast={toast} />}
    </main>
  );
}

// ===== 이스터에그 — 대기 인원 헤더 히든 존 13연타 시 모임장 응원 =====

const CHEER_TAPS = 13;
const CHEER_TAP_GAP_MS = 1000; // 이 간격 안에 이어서 눌러야 카운트 유지

// 대기 줄 [⋯] 동작을 서버 규칙대로 미리 덧씌운다 — 휴식·복귀는 대기 시간 유지, 콕 확인 취소는 콕 확인 대기로
function applyChange<T extends ISessionSnapshot['attendances'][number]>(a: T, change: AttendanceChange): T {
  if (change === 'rest') return { ...a, status: 'RESTING' };
  if (change === 'resume') return { ...a, status: 'CHECKED_IN' };
  if (change === 'leave') return { ...a, status: 'LEFT' };
  return { ...a, shuttleConfirmedAt: null };
}
function changeApplied(a: ISessionSnapshot['attendances'][number], change: AttendanceChange): boolean {
  if (change === 'rest') return a.status === 'RESTING';
  if (change === 'resume') return a.status === 'CHECKED_IN';
  if (change === 'leave') return a.status === 'LEFT';
  return !a.shuttleConfirmedAt;
}
