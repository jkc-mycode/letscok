'use client';

import {
  Gender,
  Grade,
  IAttendance,
  ICheckInCodeResponse,
  ICourt,
  IGame,
  IAdminMemo,
  IHistorySessionDetail,
  IGameRecommendation,
  IMember,
  IMemberSummary,
  ISessionSnapshot,
  MemberRole,
  RecommendationCategory,
  RecommendationKind,
} from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginGate } from '@/components/admin-gate';
import { GenderMarker, GradeBadge, PlayerGrid, Toast } from '@/components/badges';
import { HomeLink } from '@/components/home-link';
import { MotionCard } from '@/components/motion-card';
import { api, ApiError, clearPasscode, getPasscode } from '@/lib/api';
import { formatBirthInput, parseBirthDate } from '@/lib/birth-input';
import {
  formatElapsed,
  formatWaitingMinutes,
  useNow,
  useSnapshot,
} from '@/lib/use-snapshot';

// ===== 페이지 루트: 패스코드 게이트 → 보드 =====

export default function AdminPage() {
  // null = 판정 전 — localStorage는 클라이언트에만 있어서 SSR 첫 렌더와
  // 어긋나면 hydration 에러가 나므로 마운트 후에 읽는다
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setAuthed(Boolean(getPasscode()));
  }, []);

  if (authed === null) return null;
  return authed ? (
    // 잠금 = 저장된 패스코드까지 삭제해야 새로고침으로 재입장되지 않는 진짜 로그아웃
    <Board onLogout={() => { clearPasscode(); setAuthed(false); }} />
  ) : (
    <LoginGate title="렛츠콕 관제판" onSuccess={() => setAuthed(true)} />
  );
}

// ===== 보드 =====

function Board({ onLogout }: { onLogout: () => void }) {
  const { snapshot, noSession, loading, refetch } = useSnapshot();
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 모든 변경 액션의 공통 실행기 — 실패 시 서버의 한국어 메시지를 토스트로
  // 성공 시 refetch: 소켓 룸 입장 전(세션 시작 직후)이나 연결 끊김 중에도 화면이 따라오게
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Centered>불러오는 중...</Centered>;
  }
  if (noSession || !snapshot) {
    return <StartScreen run={run} busy={busy} toast={toast} />;
  }
  return (
    <BoardBody snapshot={snapshot} run={run} busy={busy} toast={toast} onLogout={onLogout} />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center text-dim">{children}</main>
  );
}

function StartScreen({
  run,
  busy,
  toast,
}: {
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  toast: string | null;
}) {
  // 명단 정리는 모임 전이 한가하다 — 세션 없이도 모임원 관리에 들어갈 수 있게
  const [membersOpen, setMembersOpen] = useState(false);
  return (
    <main className="fade-in flex min-h-dvh flex-col items-center justify-center gap-8">
      <div className="text-center">
        <HomeLink className="inline-block text-sm font-medium tracking-[0.3em] text-court transition-opacity hover:opacity-70">
          LETSCOK
        </HomeLink>
        <h1 className="mt-2 text-4xl font-bold">아직 모임 전이에요</h1>
        <p className="mt-2 text-dim">모임을 시작하면 체크인을 받을 수 있어요</p>
      </div>
      <button
        onClick={() => void run(() => api('/sessions', { method: 'POST', admin: true }))}
        disabled={busy}
        className="h-16 rounded-2xl bg-court px-12 text-xl font-bold text-bg disabled:opacity-50"
      >
        오늘 모임 시작
      </button>
      <button
        onClick={() => setMembersOpen(true)}
        className="h-11 rounded-xl border border-line px-6 text-sm font-medium text-dim"
      >
        모임원 관리
      </button>
      {membersOpen && <MembersManagerModal onClose={() => setMembersOpen(false)} />}
      {toast && <Toast message={toast} />}
    </main>
  );
}

// 폰 전용 구역 탭 — md 이상에서는 전부 동시에 보이므로 무시된다
type MobileTab = 'courts' | 'queue' | 'waiting' | 'memo';

function BoardBody({
  snapshot,
  run,
  busy,
  toast,
  onLogout,
}: {
  snapshot: ISessionSnapshot;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  toast: string | null;
  onLogout: () => void;
}) {
  const now = useNow();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false); // 운영진 수동 체크인 (사전 등록·현장 대리 등 예외용)
  const [membersOpen, setMembersOpen] = useState(false); // 모임원 관리 (명단 조회·수정·정리)

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
  const [menuOpen, setMenuOpen] = useState(false); // 폰 헤더 햄버거
  const [replaceGameId, setReplaceGameId] = useState<string | null>(null); // 선수 교체 대상 게임

  const { session, courts, attendances, games } = snapshot;

  const playingByCourt = useMemo(() => {
    const map = new Map<string, IGame>();
    for (const game of games) {
      if (game.status === 'PLAYING' && game.courtId) map.set(game.courtId, game);
    }
    return map;
  }, [games]);
  const queuedGames = useMemo(
    () => games.filter((g) => g.status === 'QUEUED'),
    [games],
  );
  const idleCourts = useMemo(
    () => courts.filter((c) => !playingByCourt.has(c.id)),
    [courts, playingByCourt],
  );
  // 콕 확인 대기 — 확인 전엔 게임 배정이 막히므로 대기 인원과 분리해 구역 맨 위에 모은다
  // (운영진은 이 섹션이 비었는지만 확인하면 된다)
  const pendingShuttle = useMemo(
    () => attendances.filter((a) => a.status !== 'LEFT' && !a.shuttleConfirmedAt),
    [attendances],
  );
  const waiting = useMemo(
    () => attendances.filter((a) => a.status === 'CHECKED_IN' && a.shuttleConfirmedAt),
    [attendances],
  );
  // 휴식 인원 — 보이되 선택 불가 (인원 파악은 되고 실수 투입은 차단)
  const restingList = useMemo(
    () => attendances.filter((a) => a.status === 'RESTING' && a.shuttleConfirmedAt),
    [attendances],
  );
  // 게임 중 포함 토글 — 잔여 인원을 게임 중/조합에 든 사람과 미리 조합할 때 켠다
  const [includeBusy, setIncludeBusy] = useState(false);
  const busyList = useMemo(
    () => attendances.filter((a) => a.status === 'PLAYING' || a.status === 'MATCHED'),
    [attendances],
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
  const replaceTarget = useMemo(
    () =>
      games.find(
        (g) => g.id === replaceGameId && (g.status === 'PLAYING' || g.status === 'QUEUED'),
      ) ?? null,
    [games, replaceGameId],
  );
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

  const createGame = () =>
    run(async () => {
      await api(`/sessions/${session.id}/games`, {
        method: 'POST',
        admin: true,
        body: { attendanceIds: [...selected] },
      });
      setSelected(new Set());
    });

  const closeSession = () => {
    if (!confirmClose) {
      setConfirmClose(true);
      setTimeout(() => setConfirmClose(false), 4000); // 4초 내 재탭 시 종료
      return;
    }
    // 모임 종료 = 그날 운영 끝 → 패스코드를 지우고 게이트로 되돌린다
    // (예전엔 홈으로 보냈지만, 홈은 관제판 앱 scope 밖이라 설치 상태에선 앱을 벗어나 버린다)
    void run(async () => {
      await api(`/sessions/${session.id}/close`, { method: 'PATCH', admin: true });
      onLogout();
    });
  };

  // 폰에서는 활성 탭만, md 이상에서는 항상 표시 (display 충돌을 피하려고 래퍼 div에만 건다)
  const pane = (...tabs: MobileTab[]) =>
    `${tabs.includes(mobileTab) ? 'flex' : 'hidden'} min-h-0 flex-col gap-3 md:flex`;

  // 헤더 액션 — 데스크톱은 가로 버튼 줄, 폰은 햄버거 메뉴로 같은 목록을 재사용한다
  const headerActions: {
    key: string;
    label: string;
    icon?: string; // 데스크톱에서 아이콘으로만 표시 (도움말)
    keepMenuOpen?: boolean; // 2탭 확인·토글이라 메뉴를 닫으면 안 되는 것
    onClick: () => void;
    cls: string;
  }[] = [
    {
      key: 'code',
      label: '체크인 코드',
      onClick: () => setCodeOpen(true),
      cls: 'border-court/50 text-court',
    },
    {
      key: 'log',
      label: '게임 기록',
      onClick: () => setGamesLogOpen(true),
      cls: 'border-line text-dim',
    },
    {
      key: 'members',
      label: '모임원 관리',
      onClick: () => setMembersOpen(true),
      cls: 'border-line text-dim',
    },
    {
      key: 'courts',
      label: '코트 관리',
      keepMenuOpen: true,
      onClick: () => setCourtsOpen((v) => !v),
      cls: courtsOpen ? 'border-court text-court' : 'border-line text-dim',
    },
    {
      key: 'close',
      label: confirmClose ? '한 번 더 누르면 종료' : '모임 종료',
      keepMenuOpen: true,
      onClick: closeSession,
      cls: confirmClose ? 'border-coral bg-coral/15 text-coral' : 'border-line text-dim',
    },
    { key: 'lock', label: '잠금', onClick: onLogout, cls: 'border-transparent text-faint' },
    {
      key: 'help',
      label: '도움말',
      icon: '?',
      onClick: () => setHelpOpen(true),
      cls: 'border-line text-dim',
    },
  ];

  const MOBILE_TABS: { value: MobileTab; label: string; count?: number }[] = [
    { value: 'courts', label: '게임 중', count: playingByCourt.size },
    { value: 'queue', label: '조합', count: queuedGames.length },
    { value: 'waiting', label: '대기', count: waiting.length },
    { value: 'memo', label: '메모' },
  ];

  return (
    <main className="fade-in flex h-dvh flex-col p-2 md:p-4">
      {/* 헤더 */}
      <header className="flex items-center gap-2 pb-2 md:gap-4 md:pb-3">
        <HomeLink className="shrink-0 transition-opacity hover:opacity-70" title="홈으로">
          <h1 className="text-base font-bold md:text-xl">
            렛츠콕 <span className="text-court">관제판</span>
          </h1>
        </HomeLink>
        <p className="truncate text-xs text-dim md:text-sm">
          {session.date} · 출석 {presentCount}명
        </p>
        {/* 데스크톱·태블릿: 가로 버튼 줄 */}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {headerActions.map((action) => (
            <button
              key={action.key}
              onClick={action.onClick}
              title={action.icon ? action.label : undefined}
              className={`h-10 rounded-lg border text-sm font-medium ${
                action.icon ? 'w-10 font-bold' : 'px-4'
              } ${action.cls}`}
            >
              {action.icon ?? action.label}
            </button>
          ))}
        </div>
        {/* 폰: 햄버거 (버튼 6개가 한 줄에 안 들어감) */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="메뉴"
          className={`ml-auto h-9 w-9 shrink-0 rounded-lg border text-sm md:hidden ${
            menuOpen ? 'border-court text-court' : 'border-line text-dim'
          }`}
        >
          ☰
        </button>
      </header>

      {menuOpen && (
        <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-line bg-panel p-2 md:hidden">
          {headerActions.map((action) => (
            <button
              key={action.key}
              onClick={() => {
                action.onClick();
                if (!action.keepMenuOpen) setMenuOpen(false);
              }}
              className={`h-11 rounded-lg border px-3 text-sm font-medium ${action.cls}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {courtsOpen && <CourtsManager sessionId={session.id} courts={courts} playingByCourt={playingByCourt} run={run} />}

      {/* 구역 탭 — 폰에서만 (md 이상은 3열로 동시 표시) */}
      <div className="flex gap-1 pb-2 md:hidden">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setMobileTab(tab.value)}
            className={`h-10 flex-1 rounded-lg border text-xs font-medium ${
              mobileTab === tab.value
                ? 'border-court bg-court/10 text-court'
                : 'border-line text-dim'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tabular ml-1 font-mono text-[11px] opacity-70">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* 3구역 — 폰: 탭 1구역 / 태블릿 세로: 2열(게임 중 | 조합+대기) / 데스크톱: 3열 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-3 md:grid-cols-2 md:grid-rows-2 lg:grid-cols-[1.15fr_1fr_1fr] lg:grid-rows-1">
        <div className={`${pane('courts')} md:row-span-2 lg:row-span-1`}>
        <Zone title="게임 중" accent="text-court" count={playingByCourt.size} className="flex-1">
          {courts.length === 0 && <Empty>코트 관리에서 사용할 코트를 등록해주세요</Empty>}
          <AnimatePresence initial={false}>
            {courts.map((court) => (
              <CourtCard
                key={court.id}
                court={court}
                game={playingByCourt.get(court.id)}
                now={now}
                run={run}
                onReplace={(g) => setReplaceGameId(g.id)}
              />
            ))}
          </AnimatePresence>
        </Zone>
        </div>

        <div className={pane('queue')}>
        <Zone title="대기 조합" accent="text-amber" count={queuedGames.length} className="flex-1">
          {queuedGames.length === 0 && <Empty>대기 인원에서 4명을 골라 조합을 만들어주세요</Empty>}
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
                onReplace={(g) => setReplaceGameId(g.id)}
              />
            ))}
          </AnimatePresence>
        </Zone>
        </div>

        {/* 대기 인원 + 운영 메모 — md 이상은 한 컬럼 세로 분할, 폰은 각각 별도 탭 */}
        <div className={pane('waiting', 'memo')}>
        <div className={`${pane('waiting')} flex-1`}>
        <Zone
          title="대기 인원"
          accent="text-ink"
          count={waiting.length}
          className="flex-1"
          headerExtra={
            <div className="ml-auto flex items-center gap-2">
              {busyList.length > 0 && (
                <button
                  onClick={() => {
                    setIncludeBusy((on) => {
                      // 끌 때 게임 중/조합 인원이 선택에 남아 보이지 않게 되는 것 방지
                      if (on) {
                        const waitingIds = new Set(waiting.map((a) => a.id));
                        setSelected((prev) => new Set([...prev].filter((id) => waitingIds.has(id))));
                      }
                      return !on;
                    });
                  }}
                  className={`h-7 rounded-lg border px-2.5 text-xs font-medium ${
                    includeBusy ? 'border-court text-court' : 'border-line text-faint'
                  }`}
                >
                  게임 중 포함
                </button>
              )}
              {/* 이스터에그 히든 존 — [수동 체크인]과 같은 크기의 보이지 않는 영역, 13연타로 발동 */}
              <span
                onClick={handleCheerTap}
                aria-hidden
                className="h-7 w-[74px] cursor-default"
              />
              <button
                onClick={() => setManualOpen(true)}
                className="h-7 rounded-lg border border-line px-2.5 text-xs font-medium text-faint"
              >
                수동 체크인
              </button>
            </div>
          }
          footer={
            <>
              <button
                onClick={() => setRecommendOpen(true)}
                disabled={busy}
                className="h-14 rounded-xl border border-court/40 px-4 text-base font-bold text-court disabled:opacity-50"
              >
                게임 추천
              </button>
              <button
                onClick={() => void createGame()}
                disabled={selected.size !== 4 || busy}
                className="h-14 flex-1 rounded-xl bg-amber text-base font-bold text-bg disabled:bg-panel2 disabled:text-faint"
              >
                조합 만들기 ({selected.size}/4)
              </button>
            </>
          }
        >
          {pendingShuttle.length > 0 && (
            <>
              <p className="pb-1 text-center text-[11px] font-medium text-amber">
                콕 확인 대기 {pendingShuttle.length}명 — 탭하면 대기 인원으로 내려가요
              </p>
              <AnimatePresence initial={false}>
                {pendingShuttle.map((attendance) => (
                  <ShuttleRow key={attendance.id} attendance={attendance} run={run} />
                ))}
              </AnimatePresence>
              <div className="mb-1 border-b border-line" />
            </>
          )}
          {waiting.length === 0 && pendingShuttle.length === 0 && (
            <Empty>체크인한 대기 인원이 없어요</Empty>
          )}
          <AnimatePresence initial={false}>
            {waiting.map((attendance) => (
              <WaitingRow
                key={attendance.id}
                attendance={attendance}
                now={now}
                selected={selected.has(attendance.id)}
                onToggle={() => toggleSelect(attendance.id)}
                run={run}
              />
            ))}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {restingList.map((attendance) => (
              <WaitingRow
                key={attendance.id}
                attendance={attendance}
                now={now}
                selected={false}
                onToggle={() => undefined}
                run={run}
                resting
              />
            ))}
          </AnimatePresence>
          {includeBusy && busyList.length > 0 && (
            <>
              <p className="pt-2 pb-1 text-center text-[11px] text-faint">
                게임 중 · 조합에 든 인원 — 미리 조합에 넣을 수 있어요
              </p>
              <AnimatePresence initial={false}>
                {busyList.map((attendance) => (
                  <WaitingRow
                    key={attendance.id}
                    attendance={attendance}
                    now={now}
                    selected={selected.has(attendance.id)}
                    onToggle={() => toggleSelect(attendance.id)}
                    run={run}
                    busyStatus={attendance.status === 'PLAYING' ? 'PLAYING' : 'MATCHED'}
                  />
                ))}
              </AnimatePresence>
            </>
          )}
          {leftCount > 0 && (
            <p className="pt-2 text-center text-xs text-faint">퇴장 {leftCount}명</p>
          )}
        </Zone>
        </div>
        <div className={`${pane('memo')} flex-1 md:max-h-[35%] md:flex-none`}>
          <MemoPanel snapshot={snapshot} run={run} busy={busy} />
        </div>
        </div>
      </div>

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
      {replaceTarget && (
        <ReplacePlayerModal
          game={replaceTarget}
          attendances={attendances}
          run={run}
          busy={busy}
          onClose={() => setReplaceGameId(null)}
        />
      )}
      {toast && <Toast message={toast} />}
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
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-4xl flex-col rounded-2xl border border-line bg-panel p-5"
      >
        <div className="flex items-center gap-3 pb-3">
          <h2 className="text-lg font-bold text-court">게임 추천</h2>
          <p className="text-xs text-faint">참고용이에요 — 넣을지는 운영진 마음!</p>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => void load()}
              className="h-9 rounded-lg border border-line px-3 text-sm text-dim"
            >
              다시 추천
            </button>
            <button
              onClick={onClose}
              className="h-9 rounded-lg border border-line px-3 text-sm text-dim"
            >
              닫기
            </button>
          </div>
        </div>

        {/* 종목 탭 — 전환 시 해당 구성으로 재요청 */}
        <div className="flex gap-1.5 pb-3">
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

        <div className="min-h-0 flex-1 overflow-y-auto">
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
                    <span className="ml-auto shrink-0 rounded bg-panel px-1.5 py-0.5 text-[10px] font-medium text-dim">
                      {rec.genderLabel}
                    </span>
                  </div>
                  <span className="mt-0.5 text-[11px] text-faint">{meta.desc}</span>
                  <div className="mt-3 flex flex-col gap-2">
                    {rec.players.map((player) => (
                      <div key={player.attendanceId} className="flex items-center gap-1.5 text-sm">
                        <GradeBadge grade={player.grade} />
                        {/* 이름이 핵심 정보 — 뱃지·통계에 밀려도 최소 한글 4자는 보장 */}
                        <span className="min-w-[4em] truncate font-medium">{player.name}</span>
                        <GenderMarker gender={player.gender} />
                        {player.isGuest && <span className="text-[10px] text-sky">G</span>}
                        {player.borrowedFrom && (
                          <span className="shrink-0 rounded bg-court/15 px-1 py-0.5 text-[10px] font-medium text-court">
                            {player.borrowedFrom === 'PLAYING' ? '게임 중' : '대기 조합'}
                          </span>
                        )}
                        <span className="tabular ml-auto shrink-0 font-mono text-[11px] text-dim">
                          {player.gamesPlayed}게임 · {player.waitingMinutes}분
                        </span>
                      </div>
                    ))}
                  </div>
                  {rec.repeatPairCount > 0 && (
                    <p className="mt-2 text-[11px] text-faint">
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
      </div>
    </div>
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
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-line bg-panel p-6 text-center"
      >
        <div className="flex w-full items-center">
          <h2 className="text-lg font-bold text-court">체크인 코드</h2>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        {error && <p className="py-8 text-sm text-coral">{error}</p>}
        {code === undefined && !error && <p className="py-8 text-sm text-dim">불러오는 중...</p>}
        {code === null && <p className="py-8 text-sm text-faint">이 모임엔 코드가 없어요(구 버전 세션)</p>}
        {code && (
          <>
            <div>
              <p className="tabular font-mono text-5xl font-bold tracking-[0.2em]">{code}</p>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                모임원은 <b>[필독]공지사항</b>의 작성월일 4자리를 입력해 체크인해요
              </p>
              <p className="mt-1 text-xs text-faint">공지를 새로 올렸다면 코드도 함께 바꿔주세요</p>
            </div>
            <CodeEditor current={code} onChanged={setCode} />
          </>
        )}
      </div>
    </div>
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
        className="text-xs text-dim underline underline-offset-4"
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
        className="tabular h-12 w-full rounded-lg border border-line bg-panel2 text-center font-mono text-lg tracking-[0.2em] outline-none placeholder:font-sans placeholder:text-xs placeholder:tracking-normal focus:border-court"
      />
      <p className="text-[11px] leading-relaxed text-faint">
        바꾼 코드는 다음 모임에도 그대로 이어져요 — 공지를 새로 올릴 때만 바꾸면 돼요
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="h-11 flex-1 rounded-lg border border-line text-sm text-dim"
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
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl border border-line bg-panel p-5"
      >
        <div className="flex items-center pb-3">
          <h2 className="text-lg font-bold text-court">선수 교체</h2>
          <p className="ml-3 text-xs text-faint">
            {isPlaying ? '타이머는 그대로 이어져요' : '조합 순서는 그대로 유지돼요'}
          </p>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
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
                  {member.isGuest && <span className="text-[10px] text-sky">G</span>}
                  {attendance.status !== 'CHECKED_IN' && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        attendance.status === 'PLAYING'
                          ? 'bg-court/15 text-court'
                          : 'bg-amber/15 text-amber'
                      }`}
                    >
                      {attendance.status === 'PLAYING' ? '게임 중' : '대기 조합'}
                    </span>
                  )}
                  <span className="tabular ml-auto shrink-0 font-mono text-[11px] text-dim">
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
      </div>
    </div>
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
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-panel/70">
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-bold text-sky">
        메모
        <span className="tabular font-mono text-xs text-faint">{memos.length}</span>
        {memos.length > 0 && (
          <button
            onClick={clearAll}
            className={`ml-auto h-7 rounded-lg border px-2.5 text-xs font-medium ${
              confirmClear ? 'border-coral bg-coral/15 text-coral' : 'border-line text-faint'
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
                className="h-7 w-7 shrink-0 rounded-lg text-xs text-faint hover:text-coral"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          maxLength={200}
          placeholder="메모 — 모임 끝나도 유지돼요"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none focus:border-court"
        />
        <button
          onClick={add}
          disabled={!input.trim() || busy}
          className="h-10 shrink-0 rounded-lg border border-court/40 px-3 text-sm font-medium text-court disabled:opacity-50"
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
        <p className="cheer-pop relative text-center text-[clamp(3rem,15vw,4.5rem)] leading-tight font-bold sm:text-[6rem]">
          <span className="block sm:inline">김강민</span>{' '}
          <span className="block sm:inline">화이팅!!</span>
        </p>
      </div>
    </div>
  );
}

// ===== 수동 체크인 모달 =====

// 모임 전 사전 등록·이미 게임 중인 인원 등을 운영진이 대신 체크인
// 미등록 인원은 구두 동의 전제로 대리 등록+체크인까지 — 게스트는 이름·급수·성별만(생년월일 미수집 정책),
// 정회원은 생년월일 포함(운영진이 알 수 있음). 본인 폰 연결은 걱정 없음:
// 나중에 본인이 코드로 들어오면 409를 /checkin이 "본인 확인 완료"로 받아 /m 진입
const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F'];

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
  // 신규 등록 폼 — 현장 대리 등록은 게스트가 흔해서 기본 게스트. 정회원 선택 시 생년월일 입력 추가
  const [regOpen, setRegOpen] = useState(false);
  const [regIsGuest, setRegIsGuest] = useState(true);
  const [regName, setRegName] = useState('');
  const [regBirth, setRegBirth] = useState('');
  const [regGrade, setRegGrade] = useState<Grade | null>(null);
  const [regGender, setRegGender] = useState<Gender | null>(null);
  const regDigits = regBirth.replace(/\D/g, '');
  const regBirthDate = parseBirthDate(regBirth);

  // 입력 후 300ms 조용하면 검색 (타이핑마다 요청하지 않도록 — /checkin과 동일 패턴)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<IMember[]>(`/members/search?name=${encodeURIComponent(trimmed)}`)
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
      setLastDone(okCount > 0 ? `${okCount}명 체크인 완료` : null);
    });
  };

  // 등록+체크인 한 번에 — 개인정보 동의는 여기서 받지 않는다(대리 등록이라 본인 의사가 아님)
  // 본인이 코드로 처음 들어올 때 /checkin에서 동의를 받아 기록한다
  const registerNew = () => {
    const name = regName.trim();
    if (!name || !regGrade || !regGender || (!regIsGuest && !regBirthDate)) return;
    void run(async () => {
      const created = await api<IMember>('/members', {
        method: 'POST',
        admin: true,
        body: {
          name,
          ...(regIsGuest ? {} : { birthDate: regBirthDate }),
          grade: regGrade,
          gender: regGender,
          isGuest: regIsGuest,
        },
      });
      await api(`/sessions/${sessionId}/attendances/manual`, {
        method: 'POST',
        admin: true,
        body: { memberId: created.id },
      });
      setLastDone(`${created.name}${regIsGuest ? ' (게스트)' : ''}님 체크인 완료`);
      setFailed([]);
      setRegOpen(false);
      setRegIsGuest(true);
      setRegName('');
      setRegBirth('');
      setRegGrade(null);
      setRegGender(null);
    });
  };

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl border border-line bg-panel p-5"
      >
        <div className="flex items-center pb-3">
          <h2 className="text-lg font-bold text-court">수동 체크인</h2>
          <p className="ml-3 text-xs text-faint">사전 등록·현장 대리 체크인용</p>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="모임원 이름을 검색하세요"
          autoFocus
          className="h-12 rounded-xl border border-line bg-panel2 px-4 outline-none focus:border-court"
        />
        <p className="pt-2 text-xs text-faint">
          탭해서 선택한 뒤 아래 [체크인] 버튼을 누르면 한 번에 처리돼요. 검색에 없으면 아래 [신규
          등록]으로 바로 등록할 수 있어요.
        </p>
        {lastDone && <p className="pt-1 text-xs font-medium text-court">{lastDone}</p>}
        {failed.length > 0 && (
          <div className="pt-1">
            {failed.map((f) => (
              <p key={f.name} className="text-xs font-medium text-coral">
                {f.name}님 실패 — {f.message}
              </p>
            ))}
          </div>
        )}

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {results.map((member) => {
            const status = statusByMemberId.get(member.id);
            const present = status !== undefined && status !== 'LEFT';
            const picked = selected.has(member.id);
            return (
              <button
                key={member.id}
                onClick={() => !present && toggle(member)}
                disabled={present}
                className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm ${
                  present
                    ? 'border-line bg-panel2 opacity-50'
                    : picked
                      ? 'border-court bg-court/15'
                      : 'border-line bg-panel2'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                    picked ? 'border-court bg-court text-bg' : 'border-line text-transparent'
                  }`}
                >
                  ✓
                </span>
                <GradeBadge grade={member.grade} />
                <span className="truncate font-medium">{member.name}</span>
                <GenderMarker gender={member.gender} />
                {member.isGuest && <span className="text-[10px] text-sky">G</span>}
                {present && (
                  <span className="shrink-0 rounded bg-court/15 px-1.5 py-0.5 text-[10px] font-medium text-court">
                    출석 중
                  </span>
                )}
                {status === 'LEFT' && (
                  <span className="shrink-0 rounded bg-amber/15 px-1.5 py-0.5 text-[10px] font-medium text-amber">
                    퇴장 — 재입장 처리
                  </span>
                )}
                {/* 동명이인 구분용 생년월일 노출 */}
                <span className="ml-auto shrink-0 text-xs text-dim">{member.birthDate}</span>
              </button>
            );
          })}
          {query.trim() && results.length === 0 && (
            <p className="py-6 text-center text-sm text-faint">검색 결과가 없어요</p>
          )}
        </div>

        {/* 선택 인원 — 검색어를 바꿔도 남으므로 여기서 전체를 확인하고 해제할 수 있게 */}
        {selected.size > 0 && (
          <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex flex-wrap gap-1.5">
              {[...selected.values()].map((member) => (
                <button
                  key={member.id}
                  onClick={() => toggle(member)}
                  className="flex items-center gap-1 rounded-lg border border-court/40 bg-court/10 px-2 py-1 text-xs font-medium text-court"
                >
                  {member.name}
                  <span className="text-faint">✕</span>
                </button>
              ))}
            </div>
            <button
              onClick={checkInSelected}
              disabled={busy}
              className="h-11 w-full rounded-xl bg-court text-sm font-bold text-bg disabled:opacity-50"
            >
              {selected.size}명 체크인
            </button>
          </div>
        )}

        {/* 신규 대리 등록 — 검색에 없는 인원을 즉석 등록+체크인 (기본 게스트, 정회원은 생년월일 추가) */}
        <div className="mt-3 border-t border-line pt-3">
          {!regOpen ? (
            <button
              onClick={() => {
                setRegOpen(true);
                setRegName(query.trim()); // 방금 검색한 이름 이어받기
              }}
              className="h-11 w-full rounded-xl border border-sky/40 text-sm font-medium text-sky"
            >
              + 신규 등록 — 검색에 없는 인원
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setRegIsGuest(true)}
                  className={`h-10 rounded-lg border text-sm font-bold ${
                    regIsGuest ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel2 text-dim'
                  }`}
                >
                  게스트
                </button>
                <button
                  onClick={() => setRegIsGuest(false)}
                  className={`h-10 rounded-lg border text-sm font-bold ${
                    !regIsGuest
                      ? 'border-court bg-court/15 text-court'
                      : 'border-line bg-panel2 text-dim'
                  }`}
                >
                  정회원
                </button>
              </div>
              <input
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                maxLength={20}
                placeholder="이름"
                className="h-11 rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-sky"
              />
              {!regIsGuest && (
                <div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={regBirth}
                    onChange={(e) => setRegBirth(formatBirthInput(e.target.value))}
                    placeholder="생년월일 8자리 (예: 19970312)"
                    className="h-11 w-full rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-court"
                  />
                  {regDigits.length === 8 && !regBirthDate && (
                    <p className="mt-1 text-xs text-coral">날짜가 올바르지 않아요</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-6 gap-1.5">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    onClick={() => setRegGrade(g)}
                    className={`h-10 rounded-lg border text-sm font-bold ${
                      regGrade === g
                        ? 'border-sky bg-sky/15 text-sky'
                        : 'border-line bg-panel2 text-dim'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setRegGender('MALE')}
                  className={`h-10 rounded-lg border text-sm font-bold ${
                    regGender === 'MALE'
                      ? 'border-sky bg-sky/15 text-sky'
                      : 'border-line bg-panel2 text-dim'
                  }`}
                >
                  ♂ 남
                </button>
                <button
                  onClick={() => setRegGender('FEMALE')}
                  className={`h-10 rounded-lg border text-sm font-bold ${
                    regGender === 'FEMALE'
                      ? 'border-pink bg-pink/15 text-pink'
                      : 'border-line bg-panel2 text-dim'
                  }`}
                >
                  ♀ 여
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setRegOpen(false)}
                  className="h-11 rounded-xl border border-line px-4 text-sm text-dim"
                >
                  취소
                </button>
                <button
                  onClick={registerNew}
                  disabled={
                    !regName.trim() ||
                    !regGrade ||
                    !regGender ||
                    (!regIsGuest && !regBirthDate) ||
                    busy
                  }
                  className="h-11 flex-1 rounded-xl bg-sky text-sm font-bold text-bg disabled:opacity-50"
                >
                  등록 + 체크인
                </button>
              </div>
              <p className="text-[11px] text-faint">
                {regIsGuest
                  ? '게스트는 생년월일을 받지 않아요. 이름·급수·성별 등록은 본인에게 구두로 동의받아 주세요.'
                  : '정회원 등록은 본인에게 구두로 동의받아 주세요. 본인 폰으로 코드 체크인하면 이 계정으로 연결돼요.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
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
const STALE_GUEST_DAYS = 90; // 이 기간 미출석 게스트를 "오래 안 온" 정리 대상으로 본다

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === 'MEMBER') return null; // 대다수가 모임원 — 배지는 예외(모임장·운영진)만
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
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

function isStaleGuest(member: IMemberSummary): boolean {
  if (!member.isGuest || member.deletedAt) return false;
  if (!member.lastAttendedAt) return true; // 등록만 되고 한 번도 안 온 게스트
  const last = new Date(member.lastAttendedAt).getTime();
  return Date.now() - last > STALE_GUEST_DAYS * 24 * 60 * 60 * 1000;
}

type MemberFilter = 'ALL' | 'REGULAR' | 'GUEST' | 'DELETED';

function MembersManagerModal({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<IMemberSummary[] | null>(null); // null=로딩
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MemberFilter>('ALL');
  const [editTarget, setEditTarget] = useState<IMemberSummary | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(
    () =>
      api<IMemberSummary[]>('/members', { admin: true })
        .then(setMembers)
        .catch(() => setToast('명단을 불러오지 못했습니다.')),
    [],
  );
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // 모달 전용 실행기 — Board의 run은 스냅샷 refetch까지 묶여 있어 세션 없는 화면에선 못 쓴다
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  const staleGuests = useMemo(() => (members ?? []).filter(isStaleGuest), [members]);

  const visible = useMemo(() => {
    const trimmed = query.trim();
    return (members ?? []).filter((member) => {
      if (trimmed && !member.name.includes(trimmed)) return false;
      // 삭제 회원은 전용 탭에서만 — 평소 목록을 어지럽히지 않는다
      if (filter === 'DELETED') return member.deletedAt !== null;
      if (member.deletedAt) return false;
      if (filter === 'REGULAR') return !member.isGuest;
      if (filter === 'GUEST') return member.isGuest;
      return true;
    });
  }, [members, query, filter]);

  const FILTER_TABS: { value: MemberFilter; label: string }[] = [
    { value: 'ALL', label: '전체' },
    { value: 'REGULAR', label: '정회원' },
    { value: 'GUEST', label: '게스트' },
    { value: 'DELETED', label: '삭제됨' },
  ];

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-2 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-panel p-4 sm:p-5"
      >
        <div className="flex items-center pb-3">
          <h2 className="text-lg font-bold text-court">모임원 관리</h2>
          {members && (
            <span className="ml-2 text-xs text-faint">
              {members.filter((m) => !m.deletedAt).length}명
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 검색"
          className="h-11 rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-court"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`h-8 rounded-lg border px-3 text-xs font-medium ${
                filter === tab.value
                  ? 'border-court bg-court/15 text-court'
                  : 'border-line bg-panel2 text-dim'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {staleGuests.length > 0 && (
            <button
              onClick={() => setCleanupOpen(true)}
              className="ml-auto h-8 rounded-lg border border-amber/40 px-3 text-xs font-medium text-amber"
            >
              오래 안 온 게스트 정리 ({staleGuests.length})
            </button>
          )}
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {members === null && <p className="py-8 text-center text-sm text-dim">불러오는 중...</p>}
          {members !== null && visible.length === 0 && (
            <p className="py-8 text-center text-sm text-faint">
              {filter === 'DELETED' ? '삭제된 모임원이 없어요' : '검색 결과가 없어요'}
            </p>
          )}
          {visible.map((member) => (
            <button
              key={member.id}
              onClick={() => setEditTarget(member)}
              className={`flex items-center gap-2 rounded-xl border border-line bg-panel2 p-3 text-left text-sm ${
                member.deletedAt ? 'opacity-50' : ''
              }`}
            >
              <GradeBadge grade={member.grade} />
              <span className="truncate font-medium">{member.name}</span>
              <GenderMarker gender={member.gender} />
              {member.isGuest && <span className="shrink-0 text-[10px] text-sky">게스트</span>}
              <RoleBadge role={member.role} />
              <span className="ml-auto flex shrink-0 flex-col items-end text-[11px] leading-tight text-dim">
                <span>{formatLastAttended(member.lastAttendedAt)}</span>
                <span className="text-faint">{member.totalGames}게임</span>
              </span>
            </button>
          ))}
        </div>

        {/* 등록 — 체크인 없이 명단에만 추가 (모임 전 사전 등록용). 모임 중 즉석 등록+체크인은 [수동 체크인]의 [신규 등록] */}
        <button
          onClick={() => setRegisterOpen(true)}
          className="mt-3 h-11 shrink-0 rounded-xl border border-sky/40 text-sm font-medium text-sky"
        >
          + 신규 등록
        </button>

        {registerOpen && (
          <MemberRegisterSheet run={run} busy={busy} onClose={() => setRegisterOpen(false)} />
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
        {toast && <Toast message={toast} />}
      </div>
    </div>
  );
}

// 신규 등록 시트 — 체크인 없이 명단에만 추가한다 (모임 전 사전 등록용, 세션 불필요)
// 모임 중 지각자 등록+체크인은 [수동 체크인]의 [신규 등록]이 담당 — 여긴 원장 작업만
function MemberRegisterSheet({
  run,
  busy,
  onClose,
}: {
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [isGuest, setIsGuest] = useState(false); // 명단 정리 맥락은 정회원 등록이 기본 (현장 즉석과 반대)
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const birthDate = parseBirthDate(birth);
  const birthDigits = birth.replace(/\D/g, '');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !grade || !gender || (!isGuest && !birthDate)) return;
    void run(async () => {
      await api('/members', {
        method: 'POST',
        admin: true,
        body: {
          name: trimmed,
          ...(isGuest ? {} : { birthDate }),
          grade,
          gender,
          isGuest,
        },
      });
      onClose();
    });
  };

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col gap-2.5 overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:rounded-2xl"
      >
        <div className="flex items-center">
          <h3 className="font-bold text-sky">신규 등록</h3>
          <p className="ml-2 text-[11px] text-faint">명단에만 추가 — 체크인 안 됨</p>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setIsGuest(false)}
            className={`h-10 rounded-lg border text-sm font-bold ${
              !isGuest ? 'border-court bg-court/15 text-court' : 'border-line bg-panel2 text-dim'
            }`}
          >
            정회원
          </button>
          <button
            onClick={() => setIsGuest(true)}
            className={`h-10 rounded-lg border text-sm font-bold ${
              isGuest ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel2 text-dim'
            }`}
          >
            게스트
          </button>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="이름"
          autoFocus
          className="h-11 rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-sky"
        />
        {!isGuest && (
          <div>
            <input
              type="text"
              inputMode="numeric"
              value={birth}
              onChange={(e) => setBirth(formatBirthInput(e.target.value))}
              placeholder="생년월일 8자리 (예: 19970312)"
              className="h-11 w-full rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-sky"
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
                grade === g ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel2 text-dim'
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
        <button
          onClick={save}
          disabled={busy || !name.trim() || !grade || !gender || (!isGuest && !birthDate)}
          className="h-11 rounded-xl bg-sky text-sm font-bold text-bg disabled:opacity-50"
        >
          등록
        </button>
        <p className="text-[11px] leading-relaxed text-faint">
          개인정보 동의는 본인이 처음 코드로 체크인할 때 받아요. 등록은 본인에게 구두로 동의받아
          주세요.
        </p>
      </div>
    </div>
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
  const [promote, setPromote] = useState(false); // 게스트→정회원 승격 의사
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
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col gap-2.5 overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:rounded-2xl"
      >
        <div className="flex items-center">
          <h3 className="font-bold text-court">{member.name}</h3>
          {member.isGuest && <span className="ml-2 text-[10px] text-sky">게스트</span>}
          {deleted && <span className="ml-2 text-[10px] text-coral">삭제됨</span>}
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>
        <p className="text-[11px] text-faint">
          출석 {member.totalSessions}회 · {member.totalGames}게임 · 최근{' '}
          {formatLastAttended(member.lastAttendedAt)}
        </p>

        {!deleted && (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="이름"
              className="h-11 rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-court"
            />

            {member.isGuest && (
              <button
                onClick={() => setPromote((v) => !v)}
                className={`h-10 rounded-lg border text-sm font-bold ${
                  promote ? 'border-court bg-court/15 text-court' : 'border-line bg-panel2 text-dim'
                }`}
              >
                {promote ? '정회원으로 승격 — 생년월일을 입력해주세요' : '정회원으로 승격하기'}
              </button>
            )}

            {asRegular && (
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={birth}
                  onChange={(e) => setBirth(formatBirthInput(e.target.value))}
                  placeholder="생년월일 8자리 (예: 19970312)"
                  className="h-11 w-full rounded-xl border border-line bg-panel2 px-4 text-sm outline-none focus:border-court"
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
              className="h-11 rounded-xl border border-court/40 text-sm font-bold text-court disabled:opacity-50"
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
              className={`h-11 rounded-xl border text-sm font-medium disabled:opacity-50 ${
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
            className={`h-11 rounded-xl border text-sm font-medium disabled:opacity-50 ${
              confirmAnon ? 'border-coral bg-coral/15 text-coral' : 'border-line text-faint'
            }`}
          >
            {confirmAnon ? '한 번 더 누르면 개인정보가 지워져요 (복구 불가)' : '개인정보 삭제 (본인 요청 시)'}
          </button>
          <p className="text-[11px] leading-relaxed text-faint">
            삭제는 명단에서만 감춰요(기록 유지·복구 가능). 개인정보 삭제는 이름·생년월일·성별을
            지우고 출석·게임 기록만 남겨요 — 본인이 요청했을 때만 사용하세요.
          </p>
        </div>
      </div>
    </div>
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
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-panel p-5 sm:rounded-2xl"
      >
        <div className="flex items-center pb-2">
          <h3 className="font-bold text-amber">오래 안 온 게스트 정리</h3>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>
        <p className="pb-3 text-xs leading-relaxed text-dim">
          {STALE_GUEST_DAYS}일 이상 안 온 게스트예요. 체크인 검색을 어지럽히지 않게 정리하세요 —
          삭제해도 지난 기록은 남고, [삭제됨] 탭에서 복구할 수 있어요.
        </p>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
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
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                    picked ? 'border-amber bg-amber text-bg' : 'border-line text-transparent'
                  }`}
                >
                  ✓
                </span>
                <GradeBadge grade={guest.grade} />
                <span className="truncate font-medium">{guest.name}</span>
                <GenderMarker gender={guest.gender} />
                <span className="ml-auto shrink-0 text-[11px] text-dim">
                  {formatLastAttended(guest.lastAttendedAt)}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={removeSelected}
          disabled={busy || selected.size === 0}
          className={`mt-3 h-11 rounded-xl border text-sm font-bold disabled:opacity-50 ${
            confirm ? 'border-coral bg-coral/15 text-coral' : 'border-amber/40 text-amber'
          }`}
        >
          {confirm ? `한 번 더 누르면 ${selected.size}명이 삭제돼요` : `${selected.size}명 삭제`}
        </button>
      </div>
    </div>
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
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-panel p-5"
      >
        <div className="flex items-center gap-3 pb-3">
          <h2 className="text-lg font-bold text-court">오늘 게임 기록</h2>
          {detail && (
            <p className="text-xs text-faint">완료 {detail.session.finishedGameCount}게임</p>
          )}
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 검색"
          className="mb-3 h-11 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none focus:border-court"
        />
        {q && detail && (
          <p className="pb-2 text-xs text-dim">
            &lsquo;{q}&rsquo; 포함 <span className="font-bold text-court">{games.length}</span>게임
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
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
      </div>
    </div>
  );
}

// ===== 도움말 모달 =====

// 정적 안내문 — 운영진 교체 시 구두 설명 없이 관제판을 넘길 수 있게 핵심 개념만 요약
const HELP_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: '기본 흐름',
    items: [
      '체크인만으로는 게임에 못 들어가요 — 대기 인원 맨 위 [콕 확인 대기]에서 콕 낸 사람을 탭해야 대기 인원으로 내려와요. 그 섹션이 비어 있으면 다 처리된 거예요.',
      '콕 확인 시각이 곧 참여 시작이에요 — 일찍 와서 콕을 늦게 낸 사람이 대기 순번을 앞지르지 않아요. 잘못 눌렀으면 행의 [콕취소]로 되돌려요 (조합·게임에 든 뒤엔 불가).',
      '대기 인원에서 4명 선택 → [조합 만들기] → 대기 조합에서 [코트 배정] → 끝나면 [게임 종료].',
      '[게임 종료]만 게임 수 +1 · 대기시간 리셋. [대기로]는 조합을 유지한 채 뒤로, [취소]·[해체]는 없던 일로 (둘 다 미집계).',
      '부상·급한 일로 한 명만 바꿀 땐 [교체] — 게임을 갈아엎지 않아 타이머·순서가 유지돼요. 빠진 사람은 대기 인원으로 돌아와요.',
      '구두 요청("○○랑 파트너 연습", "무릎 조심")은 메모에 적어두세요. 모임이 끝나도 남아 다음 모임에 이어지고, 처리했으면 ✕로 지워요.',
      '오늘 끝난 게임은 상단 [게임 기록]에서 확인해요 — 이름으로 검색하면 그 사람이 뛴 게임만 모아 볼 수 있어요.',
      '모임원이 폰에서 [잠깐 쉴래요]를 누르면 휴식으로 빠져요 — 조합 선택·게임 추천에서 제외되고, 복귀하면 대기시간이 새로 시작돼요. 대기 인원 행의 [휴식]/[복귀]로 운영진이 대신 처리할 수도 있어요.',
    ],
  },
  {
    title: '체크인 코드',
    items: [
      '모임원은 본인 화면(/m) 링크로 들어와 [체크인하러 가기] → 코드 4자리 입력 → 이름 선택 순서로 체크인해요.',
      '코드는 소모임 [필독]공지사항의 작성월일 4자리예요 — 모임원이 이미 보는 정보라 따로 공지할 게 없어요. 공지를 새로 올렸으면 [체크인 코드] 모달의 [코드 변경]으로 같이 바꿔주세요.',
      '바꾼 코드는 다음 모임에도 그대로 이어져요. 코드를 여러 번 틀리면 그 폰은 잠시 막혀요(무작위 대입 방지).',
      '한 번 들어온 모임원은 다음 모임에도 본인 화면 주소만 열면 돼요. 홈 화면에 추가해두라고 안내해주세요.',
      '모임 전에 참석자를 [수동 체크인]으로 미리 넣어두면 현장에서는 콕 확인만 하면 돼요. 미리 넣었는데 사정이 생겨 못 오게 되면 콕 확인 대기 줄의 [취소]로 지워요 — 출석 기록 없이 빠져요(퇴장과 달라요).',
      '명단에 없는 사람은 [수동 체크인] 안의 [신규 등록]으로 등록해요 — 게스트는 이름·급수·성별만(생년월일 안 받아요), 정회원은 생년월일 포함. 모임원이 스스로 가입하는 경로는 없어요(외부인 가짜 등록 차단).',
      '개인정보 동의는 본인이 처음 코드로 들어올 때 받아요 — 운영진이 대신 체크하지 않아요.',
    ],
  },
  {
    title: '모임원 관리',
    items: [
      '[모임원 관리]에서 명단 조회·등록·수정·정리를 해요. 모임 시작 전 화면에서도 열 수 있어요.',
      '[신규 등록]은 명단에만 추가돼요(체크인 안 됨) — 모임 전에 미리 등록해두는 용도예요. 모임 중 지각자는 [수동 체크인]의 [신규 등록]으로 등록+체크인을 한 번에 하세요.',
      '이름·생년월일·급수·성별·역할(모임장/운영진/모임원)을 고칠 수 있어요. 급수는 게임 추천 품질에 바로 영향을 주니 실제 실력에 맞춰주세요.',
      '역할은 명단 표시용 구분이에요 — 관제판 접근 권한은 패스코드 하나로 같아요.',
      '자주 오는 게스트는 수정 화면에서 [정회원으로 승격]할 수 있어요 (생년월일 입력 필요).',
      '삭제는 명단에서만 감춰요 — 지난 기록은 남고 [삭제됨] 탭에서 복구돼요. 진행 중 모임에 체크인된 사람은 퇴장 처리가 먼저예요.',
      '[오래 안 온 게스트 정리]로 90일 이상 미출석 게스트를 골라서 한 번에 지울 수 있어요.',
      '본인이 개인정보 삭제를 요청하면 [개인정보 삭제]를 쓰세요 — 이름·생년월일·성별이 지워지고 복구할 수 없어요.',
    ],
  },
  {
    title: '공유 코트 (다른 모임과 번갈아)',
    items: [
      '콕을 걸어 다른 모임과 순서를 나눠 쓰는 코트는 [코트 관리]에서 [공유]를 켜주세요.',
      '공유 코트는 우리 게임이 끝나면 자동으로 [다른 모임 차례]가 돼요 — 상대 게임이 끝나면 코트 카드의 [우리 차례로]를 눌러주세요(앱이 상대 게임을 알 수 없어 이 탭 하나는 필요해요).',
      '다른 모임 차례인 코트엔 배정이 막혀요 — 실수로 코트를 뺏는 걸 방지해요.',
      '연속으로 두 번 치기로 했으면(퐁퐁당) 게임 종료 후 [우리 차례로]를 눌러 이어가면 돼요. 우리 차례를 양보할 땐 [다른 모임 차례로 넘기기].',
    ],
  },
  {
    title: '게임 추천',
    items: [
      '[게임 추천]은 참고용 초안 3종 — 공정성(오래 기다린 순) / 새 조합(오늘 안 만난 사람) / 믹스.',
      '대기시간·게임 수·함께 뛴 조합·성별 구성(남복/여복/혼복)을 점수로 계산해요. 넣을지는 운영진 마음!',
      '종목 탭(남복/여복/혼복/기타 3:1)을 누르면 그 구성으로만 추천해요. 성별 미지정 멤버는 [전체] 탭에서만 나와요.',
    ],
  },
  {
    title: '겹침 · 게임 중 배지',
    items: [
      '한 사람이 여러 대기 조합에 들어갈 수 있어요 (잔여 인원을 미리 조합할 때 유용) — 두 곳 이상이면 "겹침" 배지.',
      '대기 인원의 [게임 중 포함] 토글을 켜면 게임 중·조합에 든 사람도 직접 골라 조합을 만들 수 있어요.',
      '조합에 게임 중인 사람이 있으면 그 게임이 끝날 때까지 코트 배정이 잠겨요.',
    ],
  },
  {
    title: '잠금 vs 모임 종료',
    items: [
      '[잠금] = 관제판 로그아웃만. 모임은 그대로 유지돼요.',
      '[모임 종료] = 그날 마감 — 진행 중 게임 정리 · 전원 퇴장 · 코트 해제 후 로그아웃돼요. 두 번 눌러야 실행.',
    ],
  },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl border border-line bg-panel p-5"
      >
        <div className="flex items-center pb-3">
          <h2 className="text-lg font-bold text-court">관제판 도움말</h2>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
      </div>
    </div>
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
    <section className={`flex min-h-0 flex-col rounded-2xl border border-line bg-panel/70 ${className}`}>
      <h2 className={`flex items-center gap-2 px-4 pt-3 pb-2 text-sm font-bold ${accent}`}>
        {title}
        <span className="tabular font-mono text-xs text-faint">{count}</span>
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
    <p className="flex flex-1 items-center justify-center p-6 text-center text-sm text-faint">
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
}: {
  sessionId: string;
  courts: ICourt[];
  playingByCourt: Map<string, IGame>;
  run: (a: () => Promise<unknown>) => Promise<void>;
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
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3">
      <span className="text-sm text-dim">사용 코트:</span>
      {courts.map((court) => {
        const inGame = playingByCourt.has(court.id);
        return (
          <span
            key={court.id}
            className="flex items-center gap-1 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm"
          >
            {court.courtNo}번
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
              className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                court.isShared ? 'bg-sky/15 text-sky' : 'border border-line text-faint'
              }`}
            >
              공유
            </button>
            <button
              onClick={() => void run(() => api(`/courts/${court.id}`, { method: 'DELETE', admin: true }))}
              disabled={inGame}
              title={inGame ? '게임 진행 중' : '코트 해제'}
              className="ml-1 text-faint disabled:opacity-30"
            >
              ✕
            </button>
          </span>
        );
      })}
      <input
        type="number"
        value={courtNo}
        onChange={(e) => setCourtNo(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="번호"
        className="h-9 w-20 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none focus:border-court"
      />
      <button onClick={add} className="h-9 rounded-lg bg-court px-4 text-sm font-bold text-bg">
        추가
      </button>
    </div>
  );
}

// ===== 게임 중 구역 =====

// 공유 코트 표시 — 다른 모임과 번갈아 쓰는 코트임을 카드 제목 옆에 알린다
function SharedBadge() {
  return (
    <span className="rounded bg-sky/15 px-1.5 py-0.5 text-[10px] font-medium text-sky">공유</span>
  );
}

function CourtCard({
  court,
  game,
  now,
  run,
  onReplace,
}: {
  court: ICourt;
  game?: IGame;
  now: number;
  run: (a: () => Promise<unknown>) => Promise<void>;
  onReplace: (game: IGame) => void;
}) {
  // 공유 코트 차례 전환 — 우리→상대는 수동으로도 넘길 수 있고(양보 등), 상대→우리는 이 탭이 유일한 복귀로
  const setTurn = (ourTurn: boolean) =>
    run(() =>
      api(`/courts/${court.id}/turn`, { method: 'PATCH', admin: true, body: { ourTurn } }),
    );

  if (!game) {
    // 상대 차례인 공유 코트 — 배정이 막히는 이유가 보이게 빈 코트와 구분해 크게 표시
    if (court.isShared && !court.ourTurn) {
      return (
        <MotionCard className="rounded-xl border border-sky/40 bg-sky/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-sky">
              {court.courtNo}번 코트 <SharedBadge />
            </span>
            <span className="text-xs text-sky">다른 모임 차례</span>
          </div>
          <button
            onClick={() => void setTurn(true)}
            title="상대 게임이 끝났으면 눌러주세요 — 배정이 다시 열려요"
            className="mt-3 h-11 w-full rounded-lg border border-sky/40 text-sm font-bold text-sky"
          >
            우리 차례로
          </button>
        </MotionCard>
      );
    }
    return (
      <MotionCard className="rounded-xl border border-dashed border-line p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-dim">
            {court.courtNo}번 코트 {court.isShared && <SharedBadge />}
          </span>
          <span className="text-xs text-faint">
            {court.isShared ? '렛츠콕 차례 — 대기 조합에서 배정' : '비어 있음 — 대기 조합에서 배정'}
          </span>
        </div>
        {court.isShared && (
          <button
            onClick={() => void setTurn(false)}
            title="이번 차례를 다른 모임에 양보"
            className="mt-3 h-9 w-full rounded-lg border border-line text-xs text-dim"
          >
            다른 모임 차례로 넘기기
          </button>
        )}
      </MotionCard>
    );
  }
  return (
    <MotionCard className="rounded-xl border border-court/40 bg-panel2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-court">
          {court.courtNo}번 코트 {court.isShared && <SharedBadge />}
        </span>
        <span className="tabular font-mono text-2xl font-semibold text-court">
          {game.startedAt ? formatElapsed(game.startedAt, now) : '--:--'}
        </span>
      </div>
      <PlayerGrid game={game} />
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void run(() => api(`/games/${game.id}/finish`, { method: 'PATCH', admin: true }))}
          className="h-11 flex-1 rounded-lg bg-court text-sm font-bold text-bg"
        >
          게임 종료
        </button>
        <button
          onClick={() => void run(() => api(`/games/${game.id}/unassign`, { method: 'PATCH', admin: true }))}
          title="조합 유지한 채 대기 조합 맨 뒤로 (게임 수 미집계)"
          className="h-11 rounded-lg border border-amber/40 px-3 text-sm text-amber"
        >
          대기로
        </button>
        <button
          onClick={() => onReplace(game)}
          title="부상·급한 일로 한 명만 바꾸기 (타이머 유지)"
          className="h-11 rounded-lg border border-line px-3 text-sm text-dim"
        >
          교체
        </button>
        <button
          onClick={() => void run(() => api(`/games/${game.id}/cancel`, { method: 'PATCH', admin: true }))}
          title="잘못 시작한 게임 취소 — 조합까지 해체 (게임 수 미집계)"
          className="h-11 rounded-lg border border-line px-3 text-sm text-dim"
        >
          취소
        </button>
      </div>
    </MotionCard>
  );
}

// ===== 대기 조합 구역 =====

function QueueCard({
  game,
  order,
  neighborUp,
  neighborDown,
  idleCourts,
  overlapIds,
  run,
  onReplace,
}: {
  game: IGame;
  order: number;
  neighborUp?: IGame;
  neighborDown?: IGame;
  idleCourts: ICourt[];
  overlapIds: Set<string>;
  run: (a: () => Promise<unknown>) => Promise<void>;
  onReplace: (game: IGame) => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);

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
    <MotionCard className="rounded-xl border border-amber/30 bg-panel2 p-4">
      <div className="flex items-center justify-between">
        <span className="font-bold text-amber">다음 게임 {order}</span>
        <div className="flex gap-1">
          <button
            onClick={() => swapWith(neighborUp)}
            disabled={!neighborUp}
            className="h-8 w-8 rounded-lg border border-line text-dim disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={() => swapWith(neighborDown)}
            disabled={!neighborDown}
            className="h-8 w-8 rounded-lg border border-line text-dim disabled:opacity-30"
          >
            ▼
          </button>
        </div>
      </div>
      <PlayerGrid game={game} overlapIds={overlapIds} />
      <div className="mt-3 flex gap-2">
        {busyNames.length > 0 ? (
          <span className="flex h-11 flex-1 items-center justify-center rounded-lg border border-dashed border-line px-2 text-center text-xs text-faint">
            {busyNames.join(', ')} 게임 종료 후 배정 가능
          </span>
        ) : assignOpen ? (
          idleCourts.length > 0 ? (
            idleCourts.map((court) => {
              // 상대 차례인 공유 코트 — 서버도 409로 막지만, 눌러보기 전에 이유가 보이게 비활성으로
              const theirTurn = court.isShared && !court.ourTurn;
              return (
                <button
                  key={court.id}
                  onClick={() =>
                    void run(() =>
                      api(`/games/${game.id}/assign`, {
                        method: 'PATCH',
                        admin: true,
                        body: { courtId: court.id },
                      }),
                    )
                  }
                  disabled={theirTurn}
                  title={theirTurn ? '다른 모임 차례 — 코트 카드의 [우리 차례로]를 먼저' : undefined}
                  className="h-11 flex-1 rounded-lg bg-amber text-sm font-bold text-bg disabled:bg-panel2 disabled:text-faint"
                >
                  {court.courtNo}번{theirTurn && ' (다른 모임)'}
                </button>
              );
            })
          ) : (
            <span className="flex h-11 flex-1 items-center justify-center text-sm text-faint">
              빈 코트가 없어요
            </span>
          )
        ) : (
          <button
            onClick={() => setAssignOpen(true)}
            className="h-11 flex-1 rounded-lg bg-amber/90 text-sm font-bold text-bg"
          >
            코트 배정
          </button>
        )}
        <button
          onClick={() => onReplace(game)}
          title="조합에서 한 명만 바꾸기 (순서 유지)"
          className="h-11 rounded-lg border border-line px-3 text-sm text-dim"
        >
          교체
        </button>
        <button
          onClick={() => void run(() => api(`/games/${game.id}/cancel`, { method: 'PATCH', admin: true }))}
          className="h-11 rounded-lg border border-line px-3 text-sm text-dim"
        >
          해체
        </button>
      </div>
    </MotionCard>
  );
}

// ===== 대기 인원 구역 =====

// 콕 확인 대기 행 — 행 전체가 확인 버튼이다 (시작 시간에 20명을 연속으로 눌러야 해서 탭 영역을 최대로)
// 확인 전에는 게임 배정이 막히므로 선택 체크박스는 없다
function ShuttleRow({
  attendance,
  run,
}: {
  attendance: IAttendance;
  run: (a: () => Promise<unknown>) => Promise<void>;
}) {
  // 출석 취소(노쇼) 2탭 확인 — 행 전체가 콕 확인 버튼이라 오탭 한 번에 지워지면 안 된다
  const [confirmCancel, setConfirmCancel] = useState(false);
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard
      onClick={() =>
        void run(() =>
          api(`/attendances/${attendance.id}/shuttle`, { method: 'PATCH', admin: true }),
        )
      }
      className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber/40 bg-amber/5 p-3 transition-colors"
    >
      <GradeBadge grade={member.grade} />
      <span className="truncate font-medium">{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <span className="text-[10px] text-sky">게스트</span>}
      {/* 사전 체크인 취소 — 개인 사정·노쇼 등으로 못 오게 된 사람을 출석 기록 없이 제거 (퇴장과 다름) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!confirmCancel) {
            setConfirmCancel(true);
            setTimeout(() => setConfirmCancel(false), 3000); // 잠시 뒤 원복 — 눌러둔 채 잊는 실수 방지
            return;
          }
          void run(() => api(`/attendances/${attendance.id}`, { method: 'DELETE', admin: true }));
        }}
        title="체크인 취소 — 못 오게 된 사람을 출석 기록 없이 제거"
        className={`ml-auto h-8 shrink-0 rounded-lg border px-2 text-xs font-medium ${
          confirmCancel ? 'border-coral bg-coral/15 text-coral' : 'border-line text-faint'
        }`}
      >
        {confirmCancel ? '한 번 더' : '취소'}
      </button>
      <span className="shrink-0 rounded-lg bg-amber px-2.5 py-1 text-xs font-bold text-bg">
        콕 확인
      </span>
    </MotionCard>
  );
}

function WaitingRow({
  attendance,
  now,
  selected,
  onToggle,
  run,
  busyStatus,
  resting,
}: {
  attendance: IAttendance;
  now: number;
  selected: boolean;
  onToggle: () => void;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busyStatus?: 'PLAYING' | 'MATCHED'; // 게임 중 포함 토글로 노출된 행 — 흐리게 + 상태 칩, 퇴장 버튼 없음
  resting?: boolean; // 휴식 행 — 선택 불가, 복귀·퇴장 버튼만
}) {
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard
      onClick={resting ? undefined : onToggle}
      className={`flex items-center gap-2 rounded-xl border p-3 transition-colors ${
        selected ? 'border-amber bg-amber/10' : 'border-line bg-panel2'
      } ${(busyStatus && !selected) || resting ? 'opacity-60' : ''} ${
        resting ? '' : 'cursor-pointer'
      }`}
    >
      <GradeBadge grade={member.grade} />
      <span className="font-medium">{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <span className="text-[10px] text-sky">게스트</span>}
      {busyStatus && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            busyStatus === 'PLAYING' ? 'bg-court/15 text-court' : 'bg-amber/15 text-amber'
          }`}
        >
          {busyStatus === 'PLAYING' ? '게임 중' : '대기 조합'}
        </span>
      )}
      {resting && (
        <span className="shrink-0 rounded bg-sky/15 px-1.5 py-0.5 text-[10px] font-medium text-sky">
          휴식
        </span>
      )}
      <span className="tabular ml-auto font-mono text-xs text-dim">
        {attendance.gamesPlayed}게임 · {formatWaitingMinutes(attendance.waitingSince, now)}
      </span>
      {resting && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void run(() =>
              api(`/attendances/${attendance.id}/resume`, { method: 'PATCH' }),
            );
          }}
          title="휴식 해제 — 대기로 복귀 (대기시간 리셋)"
          className="h-8 shrink-0 rounded-lg border border-sky/40 px-2 text-xs font-medium text-sky"
        >
          복귀
        </button>
      )}
      {!busyStatus && !resting && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // 행 선택 토글과 분리
            void run(() =>
              api(`/attendances/${attendance.id}/rest`, { method: 'PATCH' }),
            );
          }}
          title="휴식 처리 — 게임 조합 대상에서 제외"
          className="h-8 shrink-0 rounded-lg px-1.5 text-xs text-faint hover:text-sky"
        >
          휴식
        </button>
      )}
      {/* 콕을 잘못 확인했을 때의 유일한 복구 경로 — 되돌리면 콕 확인 대기로 올라간다 */}
      {!busyStatus && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void run(() =>
              api(`/attendances/${attendance.id}/shuttle/cancel`, {
                method: 'PATCH',
                admin: true,
              }),
            );
          }}
          title="콕 확인 취소 — 콕 확인 대기로 되돌림"
          className="h-8 shrink-0 rounded-lg px-1.5 text-xs text-faint hover:text-amber"
        >
          콕취소
        </button>
      )}
      {!busyStatus && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // 행 선택 토글과 분리
            void run(() =>
              api(`/attendances/${attendance.id}/leave`, { method: 'PATCH', admin: true }),
            );
          }}
          title="퇴장 처리"
          className="h-8 w-8 shrink-0 rounded-lg text-faint hover:text-coral"
        >
          ✕
        </button>
      )}
    </MotionCard>
  );
}
