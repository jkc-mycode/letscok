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
  ISessionSnapshot,
  RecommendationCategory,
  RecommendationKind,
} from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoginGate } from '@/components/admin-gate';
import { GenderMarker, GradeBadge, PlayerGrid, Toast } from '@/components/badges';
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
  return (
    <main className="fade-in flex min-h-dvh flex-col items-center justify-center gap-8">
      <div className="text-center">
        <Link
          href="/"
          className="inline-block text-sm font-medium tracking-[0.3em] text-court transition-opacity hover:opacity-70"
        >
          LETSCOK
        </Link>
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
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false); // 운영진 수동 체크인 (QR 오픈 지연 등 예외용)
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
  const waiting = useMemo(
    () => attendances.filter((a) => a.status === 'CHECKED_IN'),
    [attendances],
  );
  // 휴식 인원 — 보이되 선택 불가 (인원 파악은 되고 실수 투입은 차단)
  const restingList = useMemo(
    () => attendances.filter((a) => a.status === 'RESTING'),
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
    // 모임 종료 = 그날 운영 끝 → 패스코드 삭제 후 홈으로 (잠금은 게이트에 머무는 것과 다름)
    void run(async () => {
      await api(`/sessions/${session.id}/close`, { method: 'PATCH', admin: true });
      clearPasscode();
      router.push('/');
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
      key: 'qr',
      label: '체크인 QR',
      onClick: () => setQrOpen(true),
      cls: 'border-court/50 text-court',
    },
    {
      key: 'log',
      label: '게임 기록',
      onClick: () => setGamesLogOpen(true),
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
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-70" title="홈으로">
          <h1 className="text-base font-bold md:text-xl">
            렛츠콕 <span className="text-court">관제판</span>
          </h1>
        </Link>
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
          {waiting.length === 0 && <Empty>체크인한 대기 인원이 없어요</Empty>}
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
      {qrOpen && <CheckInQrModal onClose={() => setQrOpen(false)} />}
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

// ===== 체크인 QR 모달 =====

// 현장에 띄우는 오늘의 체크인 QR — 코드는 운영진 전용 엔드포인트에서 취득(공개 스냅샷엔 없음)
// QR은 스캔되려면 밝은 배경이 필요해 다크 테마여도 흰 카드 위에 그린다
function CheckInQrModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null | undefined>(undefined); // undefined=로딩, null=코드없음
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ICheckInCodeResponse>('/sessions/current/checkin-code', { admin: true })
      .then((d) => setCode(d.code))
      .catch((e) => setError(e instanceof ApiError ? e.message : '코드를 불러오지 못했습니다.'));
  }, []);

  // 절대 URL — 모임원 폰이 접속할 주소라 현재 배포 도메인 기준
  const url = code ? `${window.location.origin}/checkin?c=${code}` : '';

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
          <h2 className="text-lg font-bold text-court">체크인 QR</h2>
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
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={url} size={240} level="M" />
            </div>
            <div>
              <p className="text-xs text-dim">현장 입구에 띄워두세요 · 스캔하면 체크인</p>
              <p className="tabular mt-1 font-mono text-3xl font-bold tracking-[0.2em]">{code}</p>
              <p className="mt-1 text-xs text-faint">카메라가 안 되면 이 코드를 불러주세요</p>
            </div>
          </>
        )}
      </div>
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

// ===== 수동 체크인 모달 =====

// QR 오픈이 늦어 이미 게임 중인 인원 등을 운영진이 대신 체크인
// 미등록 인원은 구두 동의 전제로 대리 등록+체크인까지 — 게스트는 이름·급수·성별만(생년월일 미수집 정책),
// 정회원은 생년월일 포함(운영진이 알 수 있음). 본인 폰 연결은 걱정 없음:
// 나중에 QR 스캔하면 409를 /checkin이 "본인 확인 완료"로 받아 /m 진입
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
  const [lastDone, setLastDone] = useState<string | null>(null); // 연속 입력용 직전 완료 표시
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

  const checkIn = (member: IMember) =>
    run(async () => {
      await api(`/sessions/${sessionId}/attendances/manual`, {
        method: 'POST',
        admin: true,
        body: { memberId: member.id },
      });
      setLastDone(member.name); // 모달은 열어둔다 — 지각 시나리오는 보통 여러 명 연속 입력
    });

  // 등록+체크인 한 번에 — consent는 현장 구두 동의 전제(운영진이 본인에게 확인)
  const registerNew = () => {
    const name = regName.trim();
    if (!name || !regGrade || !regGender || (!regIsGuest && !regBirthDate)) return;
    void run(async () => {
      const created = await api<IMember>('/members', {
        method: 'POST',
        body: {
          name,
          ...(regIsGuest ? {} : { birthDate: regBirthDate }),
          grade: regGrade,
          gender: regGender,
          isGuest: regIsGuest,
          consent: true,
        },
      });
      await api(`/sessions/${sessionId}/attendances/manual`, {
        method: 'POST',
        admin: true,
        body: { memberId: created.id },
      });
      setLastDone(`${created.name}${regIsGuest ? ' (게스트)' : ''}`);
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
          <p className="ml-3 text-xs text-faint">QR 오픈이 늦었을 때 등 예외용</p>
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
          탭하면 바로 체크인돼요. 검색에 없으면 아래 [신규 등록]으로 바로 등록할 수 있어요.
        </p>
        {lastDone && (
          <p className="pt-1 text-xs font-medium text-court">{lastDone}님 체크인 완료</p>
        )}

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {results.map((member) => {
            const status = statusByMemberId.get(member.id);
            const present = status !== undefined && status !== 'LEFT';
            return (
              <button
                key={member.id}
                onClick={() => !present && void checkIn(member)}
                disabled={present || busy}
                className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm ${
                  present ? 'border-line bg-panel2 opacity-50' : 'border-line bg-panel2'
                }`}
              >
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
                  : '정회원 등록은 본인에게 구두로 동의받아 주세요. 본인 폰으로 QR을 스캔하면 이 계정으로 연결돼요.'}
              </p>
            </div>
          )}
        </div>
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
      '대기 인원에서 4명 선택 → [조합 만들기] → 대기 조합에서 [코트 배정] → 끝나면 [게임 종료].',
      '[게임 종료]만 게임 수 +1 · 대기시간 리셋. [대기로]는 조합을 유지한 채 뒤로, [취소]·[해체]는 없던 일로 (둘 다 미집계).',
      '부상·급한 일로 한 명만 바꿀 땐 [교체] — 게임을 갈아엎지 않아 타이머·순서가 유지돼요. 빠진 사람은 대기 인원으로 돌아와요.',
      '구두 요청("○○랑 파트너 연습", "무릎 조심")은 메모에 적어두세요. 모임이 끝나도 남아 다음 모임에 이어지고, 처리했으면 ✕로 지워요.',
      '오늘 끝난 게임은 상단 [게임 기록]에서 확인해요 — 이름으로 검색하면 그 사람이 뛴 게임만 모아 볼 수 있어요.',
      '모임원이 폰에서 [잠깐 쉴래요]를 누르면 휴식으로 빠져요 — 조합 선택·게임 추천에서 제외되고, 복귀하면 대기시간이 새로 시작돼요. 대기 인원 행의 [휴식]/[복귀]로 운영진이 대신 처리할 수도 있어요.',
    ],
  },
  {
    title: '체크인 QR',
    items: [
      '모임원은 현장 QR을 스캔해야만 체크인돼요 (코드 없는 주소는 차단).',
      '[체크인 QR] 모달을 입구 화면에 띄워두세요. 코드는 모임마다 새로 발급되고 그날 내내 같아요.',
      '카메라가 안 되는 폰은 모달 하단 6자리 코드를 불러주세요.',
      'QR 오픈이 늦어 이미 게임 중인 사람들은 대기 인원의 [수동 체크인]으로 넣어주세요. 본인 폰은 나중에 QR을 스캔하면 그대로 연결돼요.',
      '미등록 인원은 [수동 체크인] 안의 [신규 등록]으로 바로 등록+체크인할 수 있어요 — 게스트는 이름·급수·성별만(생년월일 안 받아요), 정회원은 생년월일 포함. 구두 동의는 받아주세요.',
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
  if (!game) {
    return (
      <MotionCard className="rounded-xl border border-dashed border-line p-4">
        <div className="flex items-center justify-between">
          <span className="font-bold text-dim">{court.courtNo}번 코트</span>
          <span className="text-xs text-faint">비어 있음 — 대기 조합에서 배정</span>
        </div>
      </MotionCard>
    );
  }
  return (
    <MotionCard className="rounded-xl border border-court/40 bg-panel2 p-4">
      <div className="flex items-center justify-between">
        <span className="font-bold text-court">{court.courtNo}번 코트</span>
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
            idleCourts.map((court) => (
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
                className="h-11 flex-1 rounded-lg bg-amber text-sm font-bold text-bg"
              >
                {court.courtNo}번
              </button>
            ))
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
