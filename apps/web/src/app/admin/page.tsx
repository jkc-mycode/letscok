'use client';

import { GAME_SIZE, IFillCourtsResult, IGame, IGameRecommendation, ISessionSnapshot } from '@letscok/shared-types';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ExitGuard } from '@/components/exit-guard';
import { Toast } from '@/components/badges';
import { InstallPrompt } from '@/components/install-prompt';
import { LogoLoader } from '@/components/logo-loader';
import { api, ApiError } from '@/lib/api';
import { useOptimisticMap } from '@/lib/use-optimistic-map';
import { useSnapshot } from '@/lib/use-snapshot';
import { ToastState, useToast } from '@/lib/use-toast';
import { MembersManagerModal } from '@/components/admin/members-manager';
import { ManualCheckInModal } from '@/components/admin/manual-check-in';
import { RecommendModal } from '@/components/admin/recommend-sheet';
import { CourtPickSheet, CourtsManager } from '@/components/admin/courts-manager';
import { TodayGamesModal } from '@/components/admin/today-games';
import { HelpModal } from '@/components/admin/help-sheet';
import { AnotherSessionSheet } from '@/components/admin/another-session';
import { CheckInCodeModal } from '@/components/admin/check-in-code';
import { sessionName } from '@/components/session-switcher';
import { BoardHeader, MobileTabBar, MoreMenuSheet, useTabSwipe, type MoreAction } from '@/components/admin/board-chrome';
import { CourtsZone, QueueZone, RosterZone } from '@/components/admin/board-zones';
import { MemoPanel } from '@/components/admin/memo-panel';
import { CheerEasterEgg } from '@/components/admin/cheer';
import {
  ROSTER_SORT_KEY,
  RosterSort,
  readRosterSort,
  sortCandidates,
  sortRoster,
} from '@/components/admin/roster-sort';
import { RosterDrop, buildPlaceLabels, isFullGame } from '@/components/admin/board-slots';
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
  // 들어간 모임은 주소(/admin?session=id)에 적는다 — 새로고침해도 그 보드가 유지되고, 주소가 없으면 첫 화면에서 고른다
  // 기록을 쌓지 않고 바꾸기만 한다: 쌓으면 설치 앱의 "뒤로 한 번 더 누르면 종료"와 엉킨다
  const [boardId, setBoardId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session'),
  );
  const showBoard = (id: string | null) => {
    if (!id) switchedInBoard.current = false; // 첫 화면을 거쳐 들어가면 다시 등장 효과
    setBoardId(id);
    window.history.replaceState(window.history.state, '', id ? `/admin?session=${encodeURIComponent(id)}` : '/admin');
  };
  const { snapshot, noSession, failed, loading, refetch, memosVersion, selectSession } = useSnapshot({ prefer: boardId });
  const { toast, showToast, hideToast } = useToast();
  const [inFlight, setInFlight] = useState(0); // 진행 중인 요청 수 — 팝업 버튼은 이게 0일 때만 켠다
  const busy = inFlight > 0;
  const lockedKeys = useRef(new Set<string>()); // 같은 대상(게임·조합 순서 등)을 연달아 누른 것만 막는다
  // 방금 종료한 모임의 마무리 문구 — 종료하면 보드(BoardBody)가 사라지므로 상태는 여기서 들고 있다.
  // 문구 팝업을 닫아야 패스코드를 지우고 로그인 화면으로 간다(종료 = 그날 운영 끝)
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  // 열린 모임이 있어도 바로 보드로 가지 않고 첫 화면에서 들어갈 모임을 고른다 — 여복·남복 날 다른 모임 보드를 거치지 않고
  // 바로 모임을 열 수 있게. 이 기기에서 모임을 시작·새로 열었으면 바로 들어간다
  const enter = async (id: string) => {
    await selectSession(id);
    showBoard(id);
  };
  // 보드에서 칩으로 모임을 바꿀 땐 보드를 새로 그려도(다른 모임 임시 표시가 섞이지 않게) 등장 효과·보던 구역은 그대로 —
  // 바꿀 때마다 보드가 흐려졌다 나타나고 폰은 '명단' 구역으로 튀었다
  const switchedInBoard = useRef(false);
  const switchBoard = (id: string) => {
    switchedInBoard.current = true;
    return enter(id);
  };
  // 폰 전용 구역 탭 — 조작 시작점인 대기 인원이 기본
  const [mobileTab, setMobileTab] = useState<MobileTab>('waiting');
  const entered = boardId !== null && (snapshot?.openSessions.some((s) => s.id === boardId) ?? false);
  // 주소의 모임이 그사이 끝났으면 첫 화면으로(주소도 정리)
  useEffect(() => {
    if (boardId && !loading && !failed && (noSession || (snapshot && !entered))) showBoard(null);
  }, [boardId, loading, failed, noSession, snapshot, entered]);
  const report = reportSessionId && (
    <SessionReportModal
      sessionId={reportSessionId}
      onClose={() => {
        setReportSessionId(null);
        // 동시에 연 다른 모임이 남아 있으면 첫 화면 목록에 있다 — 그날 운영이 끝난 게 아니라 잠그지 않는다
        if (!snapshot) onLogout();
      }}
    />
  );

  // 성공 뒤 새로고침은 마지막 요청 뒤 한 번만 — 실시간 화면이 보통 먼저 오고, 이건 소켓 룸 입장 전·연결 끊김 대비.
  // 요청마다 하면 [모두 콕 확인]으로 20명이면 요청이 40개가 되어 분당 요청 제한에 가까워진다
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);
  // 그 사이 실시간 현황이 도착했으면 다시 부르지 않는다 — 보통 소켓이 먼저 와서 같은 현황을 두 번 받고 있었다(놓쳤을 때만 보충)
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const scheduleRefetch = () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    const seen = latestSnapshot.current;
    refetchTimer.current = setTimeout(() => {
      if (latestSnapshot.current === seen) void refetch();
    }, 400);
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
  if (noSession || !snapshot || !entered) {
    return (
      <>
        <StartScreen
          run={run}
          busy={busy}
          toast={toast}
          onLogout={onLogout}
          openSessions={noSession ? [] : (snapshot?.openSessions ?? [])}
          onEnter={enter}
        />
        {report}
      </>
    );
  }
  return (
    <>
      {/* 모임을 바꾸면 보드를 새로 그린다 — 누르자마자 반영 중이던 표시·고른 사람이 다른 모임으로 넘어가지 않게 */}
      <BoardBody
        key={snapshot.session.id}
        snapshot={snapshot}
        memosVersion={memosVersion}
        onSelectSession={switchBoard}
        animateIn={!switchedInBoard.current}
        mobileTab={mobileTab}
        setMobileTab={setMobileTab}
        run={run}
        runParallel={runParallel}
        busy={busy}
        toast={toast}
        showToast={showToast}
        hideToast={hideToast}
        onLogout={onLogout}
        onSessionClosed={(id) => {
          setReportSessionId(id);
          showBoard(null); // 남은 모임이 있으면 첫 화면 목록에서 다시 고른다
        }}
      />
      {report}
    </>
  );
}

// 폰 전용 구역 탭 — md 이상에서는 전부 동시에 보이므로 무시된다
type MobileTab = 'courts' | 'queue' | 'waiting' | 'memo';

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
  memosVersion,
  run,
  runParallel,
  busy,
  toast,
  showToast,
  hideToast,
  onLogout,
  onSessionClosed,
  onSelectSession,
  animateIn,
  mobileTab,
  setMobileTab,
}: {
  snapshot: ISessionSnapshot;
  memosVersion: number;
  onSelectSession: (id: string) => Promise<void>; // 동시에 연 다른 모임으로 바꿔 보기
  animateIn: boolean; // 처음 들어갈 때만 등장 효과
  mobileTab: MobileTab; // 폰 구역 탭 — 모임을 바꿔도 보던 구역 유지(Board가 들고 있다)
  setMobileTab: (tab: MobileTab) => void;
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
  const [anotherOpen, setAnotherOpen] = useState(false); // 모임 하나 더 열기(여복·남복)

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
  // 폰(<md)에서는 3구역을 한 번에 못 보여주므로 탭 전환(mobileTab) — 상태는 Board가 들고 있다
  const boardRef = useRef<HTMLElement>(null); // 탭 스와이프가 --drag를 다는 바깥 틀
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
  const concurrent = snapshot.openSessions.length > 1; // 여복·남복처럼 동시에 연 모임이 있다
  const dragEnabled = useBoardDragEnabled(); // 태블릿 이상 — 자석판처럼 끌어다 놓기
  // 보드가 떠 있는 동안 페이지 전체가 고무줄처럼 출렁이지 않게 — 짧아서 스크롤이 없는 목록에서 민 손짓은 곧장 페이지로 간다
  // 보드는 화면에 딱 맞춰 그려서 페이지 자체를 끌어당길 일이 없다(당겨서 새로고침도 보드에선 실수에 가깝다)
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overscrollBehavior;
    root.style.overscrollBehavior = 'none';
    return () => {
      root.style.overscrollBehavior = previous;
    };
  }, []);

  // 코트 배정·조합 만들기는 누르자마자 보여 준다 — 서버 응답과 화면 새로고침(두 번 오감)을 기다리면 멈춘 것처럼 보였다.
  // 서버 화면에 실리면 이 표시는 지우고, 실패하면 되돌린다(알림은 runParallel)
  const [optAssign, assignOpt] = useOptimisticMap<{ courtId: string; startedAt: string }>(
    (id) => snapshot.games.find((g) => g.id === id)?.status === 'QUEUED', // 서버에서 '게임 중'이 되면 지운다
    snapshot.games,
  );
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
  const [optEnded, endedOpt] = useOptimisticMap<{ kind: 'FINISHED' | 'UNASSIGNED'; at: string }>(
    (id) => snapshot.games.find((g) => g.id === id)?.status === 'PLAYING',
    snapshot.games,
  );
  useEffect(() => {
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
  const [optTurn, turnOpt] = useOptimisticMap<boolean>((id, ourTurn) => {
    const court = snapshot.courts.find((c) => c.id === id);
    return court !== undefined && court.ourTurn !== ourTurn;
  }, snapshot.courts);
  const courts = useMemo(
    () => overlayCourts(snapshot.courts, snapshot.games, optEnded, optTurn),
    [snapshot.courts, snapshot.games, optEnded, optTurn],
  );
  const setCourtTurn = useCallback(
    (courtId: string, ourTurn: boolean) => {
      turnOpt.set(courtId, ourTurn);
      void runParallel(() => api(`/courts/${courtId}/turn`, { method: 'PATCH', admin: true, body: { ourTurn } })).then(
        (ok) => !ok && turnOpt.remove(courtId), // 실패 — 서버 화면대로(알림은 runParallel)
      );
    },
    [runParallel, turnOpt],
  );
  const endGame = useCallback(
    (gameId: string, kind: 'FINISHED' | 'UNASSIGNED'): Promise<boolean> => {
      // 이미 누른 게임·배정이 서버에 아직 안 닿은 게임(종료하면 409)은 무시
      if (optEnded.has(gameId) || optAssign.has(gameId)) return Promise.resolve(false);
      endedOpt.set(gameId, { kind, at: new Date().toISOString() });
      const path = kind === 'FINISHED' ? 'finish' : 'unassign';
      const clearEnded = () => endedOpt.remove(gameId);
      const courtNo = snapshot.courts.find((c) => c.id === games.find((g) => g.id === gameId)?.courtId)?.courtNo;
      // 결과(성공 여부)를 돌려준다 — AI 명령은 서버에 닿은 뒤 다음 단계로 넘어간다(다음 추천이 끝난 사람을 대기로 보게)
      return runParallel(() => api(`/games/${gameId}/${path}`, { method: 'PATCH', admin: true })).then((ok) => {
        if (!ok) {
          clearEnded();
          return false;
        }
        if (kind !== 'FINISHED') return true;
        // 잘못 누른 종료는 보통 바로 알아챈다 — 10초 동안 [되돌리기](그 뒤엔 게임 기록에서 길게 눌러 되돌린다)
        showToast(`${courtNo ? `${courtNo}번 코트 ` : ''}게임 종료`, 'success', 10_000, {
          label: '되돌리기',
          onClick: () => {
            hideToast();
            // 종료 덧씌움은 서버 화면이 '게임 중'인 동안 남는다 — 되돌린 게임이 계속 끝난 것처럼 보이지 않게 먼저 지운다
            clearEnded();
            void run(() => api(`/games/${gameId}/reopen`, { method: 'PATCH', admin: true }), `game:${gameId}`);
          },
        });
        return true;
      });
    },
    [optEnded, optAssign, endedOpt, runParallel, run, snapshot.courts, games, showToast, hideToast],
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
      assignOpt.set(gameId, { courtId, startedAt: new Date().toISOString() });
      void runParallel(() => api(`/games/${gameId}/assign`, { method: 'PATCH', admin: true, body: { courtId } })).then(
        (ok) => !ok && assignOpt.remove(gameId),
      );
    },
    [optAssign, assignOpt, runParallel],
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
    (ids: string[], removeFrom?: string, onDone?: (ok: boolean) => void) => {
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
        void patchGames([[origin, (players) => players.filter((p) => p.attendanceId !== ids[0])]], request).then((ok) => onDone?.(ok));
      } else {
        void runParallel(request).then((ok) => onDone?.(ok));
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
    plan.forEach(({ gameId, courtId }) => assignOpt.set(gameId, { courtId, startedAt }));
    const undo = (gameIds: string[]) => assignOpt.remove(...gameIds);
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
  const [confirming, confirmingOpt] = useOptimisticMap<string>( // 출석 id → 누른 시각
    (id) => !attendances.find((a) => a.id === id)?.shuttleConfirmedAt,
    attendances,
  );
  // 대기 줄 [⋯] 휴식·복귀·퇴장·콕 확인 취소도 누르자마자 반영 — 서버 화면이 같아지면 지우고, 실패하면 되돌린다
  const [optAttendance, attendanceOpt] = useOptimisticMap<AttendanceChange>((id, change) => {
    const a = attendances.find((x) => x.id === id);
    return a !== undefined && !changeApplied(a, change);
  }, attendances);
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
  const changeAttendance = (attendanceId: string, change: AttendanceChange): Promise<boolean> => {
    if (optAttendance.has(attendanceId)) return Promise.resolve(false);
    attendanceOpt.set(attendanceId, change);
    const admin = change === 'leave' || change === 'shuttle/cancel';
    return runParallel(() =>
      api(`/attendances/${attendanceId}/${change}`, { method: 'PATCH', ...(admin && { admin: true }) }),
    ).then((ok) => {
      if (!ok) attendanceOpt.remove(attendanceId); // 실패 — 서버 화면대로(알림은 runParallel)
      return ok;
    });
  };
  const confirmShuttle = (attendanceId: string) => {
    if (confirming.has(attendanceId)) return;
    confirmingOpt.set(attendanceId, new Date().toISOString());
    void runParallel(() => api(`/attendances/${attendanceId}/shuttle`, { method: 'PATCH', admin: true })).then(
      (ok) => !ok && confirmingOpt.remove(attendanceId), // 실패 — 콕 확인 대기로 되돌린다(알림은 runParallel이 띄움)
    );
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
  const headerActions: MoreAction[] = [
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
    {
      key: 'another',
      label: '모임 하나 더 열기 — 코트를 나눠 따로 운영',
      onClick: () => setAnotherOpen(true),
    },
  ];

  const MOBILE_TABS: { value: MobileTab; label: string; count?: number }[] = [
    { value: 'courts', label: '게임 중', count: playingByCourt.size },
    { value: 'queue', label: '조합', count: queuedGames.length },
    { value: 'waiting', label: '명단', count: waitingCount },
    { value: 'memo', label: '메모' },
  ];
  const tabIndex = MOBILE_TABS.findIndex((tab) => tab.value === mobileTab);
  const swipeHandlers = useTabSwipe({
    boardRef,
    tabIndex,
    tabCount: MOBILE_TABS.length,
    dragging: dndDragging,
    onSwipe: (step) => setMobileTab(MOBILE_TABS[tabIndex + step].value),
  });

  return (
    <main
      ref={boardRef}
      style={{ '--tab-index': tabIndex } as React.CSSProperties}
      className={`${animateIn ? 'fade-in ' : ''}flex h-dvh flex-col overflow-x-hidden overscroll-none p-2 md:p-4`}
    >
      {/* 설치 안내 — 카톡으로 연 운영진도 브라우저로 나가게. 설치된 앱에선 뜨지 않는다 */}
      <InstallPrompt app="admin" className="mb-2 shrink-0" />
      <BoardHeader
        date={session.date}
        presentCount={presentCount}
        openSessions={snapshot.openSessions}
        sessionId={session.id}
        onSelectSession={onSelectSession}
        onOpenCode={() => setCodeOpen(true)}
        onOpenLog={() => setGamesLogOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
      />

      {/* 3구역 — 폰: 탭 1구역 / 태블릿 세로: 2열(게임 중 | 조합+대기) / 데스크톱: 3열 */}
      <BoardDnd onDrop={onDrop} onDraggingChange={onDraggingChange}>
      <div
        onTouchStart={swipeHandlers.onTouchStart}
        onTouchMove={swipeHandlers.onTouchMove}
        onTouchEnd={swipeHandlers.onTouchEnd}
        onTouchCancel={swipeHandlers.onTouchEnd}
        className="board-track flex min-h-0 flex-1 md:grid md:grid-cols-2 md:grid-rows-2 md:gap-3 lg:grid-cols-[1.15fr_1fr_1fr] lg:grid-rows-1"
      >
        <div className={`${pane} md:row-span-2 lg:row-span-1`}>
        <CourtsZone
          courts={courts}
          playingByCourt={playingByCourt}
          slotActions={slotActions}
          dragEnabled={dragEnabled}
          onManageCourts={() => setCourtsOpen(true)}
          onTurn={setCourtTurn}
          onEnd={endGame}
          onMore={(g) => setCardMenuId(g.id)}
        />
        </div>

        <div className={pane}>
        <QueueZone
          queuedGames={queuedGames}
          idleCourts={idleCourts}
          overlapIds={overlapIds}
          fillableCount={fillableCount}
          fillNotice={fillNotice}
          slotActions={slotActions}
          dragEnabled={dragEnabled}
          onFillCourts={fillCourts}
          onNewGame={() => setSlotTarget({ gameId: null })}
          onCancel={cancelGame}
          onMore={(g) => setCardMenuId(g.id)}
          onPickCourt={(g) => setAssignGameId(g.id)}
          onAssign={assignToCourt}
          onMove={moveQueue}
          onFillSlot={(g) => setSlotTarget({ gameId: g.id })}
          onRecommend={(g) => setRecommendFillId(g.id)}
        />
        </div>

        {/* 대기 인원 + 운영 메모 — md 이상은 한 컬럼 세로 분할, 폰은 각각 별도 탭(래퍼가 사라져 두 구역이 트랙에 바로 놓인다) */}
        <div className="flex min-h-0 flex-col gap-3 max-md:contents">
        <RosterDrop className={`${pane} flex-1`} dragEnabled={dragEnabled}>
        <RosterZone
          roster={roster}
          pendingShuttle={pendingShuttle}
          leftCount={leftCount}
          selected={selected}
          rosterSort={rosterSort}
          placeLabels={placeLabels}
          partnerNames={partnerNames}
          dragEnabled={dragEnabled}
          run={run}
          onRosterSort={setRosterSort}
          onCheerTap={handleCheerTap}
          onManualCheckIn={() => setManualOpen(true)}
          onCommand={() => setCommandOpen(true)}
          onRecommend={() => setRecommendOpen(true)}
          onCreateGame={createGame}
          onConfirmShuttle={confirmShuttle}
          onToggle={toggleSelect}
          onMore={(a) => setActionId(a.id)}
        />
        </RosterDrop>
        <div className={`${pane} flex-1 md:max-h-[35%] md:flex-none`}>
          <MemoPanel version={memosVersion} run={run} />
        </div>
        </div>
      </div>
      </BoardDnd>

      <MobileTabBar tabs={MOBILE_TABS} current={mobileTab} onChange={setMobileTab} />

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
      {menuOpen && (
        <MoreMenuSheet
          actions={headerActions}
          closeLabel={concurrent ? `${sessionName(snapshot.openSessions, session.id)} 모임 종료` : '모임 종료'}
          onCloseSession={closeSession}
          onLogout={onLogout}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {anotherOpen && (
        <AnotherSessionSheet
          unnamed={session.label ? undefined : session}
          openSessions={snapshot.openSessions}
          run={run}
          onOpened={onSelectSession}
          onClose={() => setAnotherOpen(false)}
        />
      )}
      {commandOpen && (
        <CommandSheet
          sessionId={session.id}
          live={{ attendances, games }}
          run={run}
          board={{
            endGame: (gameId) => endGame(gameId, 'FINISHED'),
            changeAttendance,
            startGame: (ids) => new Promise((resolve) => startGame(ids, undefined, resolve)),
          }}
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
