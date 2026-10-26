'use client';

import { ISessionSnapshot } from '@letscok/shared-types';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginGate, useAdminAuth } from '@/components/admin-gate';
import { BirthdayCalendarModal } from '@/components/birthday-calendar';
import { BoardDnd, TEMP_GAME_PREFIX, useBoardDragEnabled } from '@/components/board-dnd';
import { CommandSheet } from '@/components/command-sheet';
import { ConnectionError } from '@/components/connection-error';
import { SessionReportModal } from '@/components/session-report-modal';
import { EntryFeeSheet } from '@/components/entry-fee-sheet';
import { SettlementModal } from '@/components/settlement-modal';
import { ExitGuard } from '@/components/exit-guard';
import { buildSameNameTags, SameNameTagsProvider, Toast } from '@/components/badges';
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
  sortRoster,
} from '@/components/admin/roster-sort';
import { RosterDrop, buildPlaceLabels, isFullGame } from '@/components/admin/board-slots';
import {
  GameActionSheet,
  ReplacePlayerModal,
  SlotFillSheet,
  WaitingActionSheet,
} from '@/components/admin/action-sheets';
import { StartScreen } from '@/components/admin/start-screen';
import { firstFreeSlot, useOptimisticBoard } from '@/components/admin/use-optimistic-board';

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

  const {
    games,
    attendances,
    courts,
    playingByCourt,
    queuedGames,
    idleCourts,
    shuttleView,
    pendingShuttle,
    fillableCount,
    fillNotice,
    optCreated,
    setCourtTurn,
    endGame,
    patchGames,
    replacePlayer,
    cancelGame,
    slotActions,
    assignToCourt,
    moveGame,
    moveQueue,
    startGame,
    growTemp,
    onDrop,
    fillCourts,
    changeAttendance,
    confirmShuttle,
    slotTempOf,
    addRecommended,
  } = useOptimisticBoard({ snapshot, run, runParallel, showToast, hideToast });
  // 폰: 조합 카드를 끄는 동안 구역 좌우 넘기기가 끼어들지 않게
  const dndDragging = useRef(false);
  const onDraggingChange = useCallback((dragging: boolean) => {
    dndDragging.current = dragging;
  }, []);
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
  // 동명이인 꼬리표 — 명단·카드·시트의 이름 뒤에 "97"·"①"
  const sameNameTags = useMemo(() => buildSameNameTags(attendances), [attendances]);
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
    <SameNameTagsProvider value={sameNameTags}>
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
            swapCourts={courts
              .filter((c) => c.id !== moveTarget.courtId && playingByCourt.has(c.id))
              .sort((a, b) => a.courtNo - b.courtNo)}
            title={`${courts.find((c) => c.id === moveTarget.courtId)?.courtNo ?? ''}번 코트에서 어디로 옮길까요?`}
            onAssign={moveGame}
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
    </SameNameTagsProvider>
  );
}

// ===== 이스터에그 — 대기 인원 헤더 히든 존 13연타 시 모임장 응원 =====

const CHEER_TAPS = 13;
const CHEER_TAP_GAP_MS = 1000; // 이 간격 안에 이어서 눌러야 카운트 유지
