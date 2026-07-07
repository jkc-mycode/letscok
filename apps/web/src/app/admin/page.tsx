'use client';

import {
  IAttendance,
  ICourt,
  IGame,
  IGameRecommendation,
  ISessionSnapshot,
  RecommendationKind,
} from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GradeBadge, PlayerGrid, Toast } from '@/components/badges';
import { MotionCard } from '@/components/motion-card';
import { api, ApiError, clearPasscode, getPasscode, savePasscode } from '@/lib/api';
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
    <Board onLogout={() => setAuthed(false)} />
  ) : (
    <LoginGate onSuccess={() => setAuthed(true)} />
  );
}

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    savePasscode(passcode); // api()가 저장된 값을 헤더로 보내므로 먼저 저장 후 검증
    try {
      await api('/auth/admin/verify', { method: 'POST', admin: true });
      onSuccess();
    } catch (e) {
      clearPasscode();
      setError(e instanceof ApiError ? e.message : '연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fade-in flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <p className="text-sm font-medium tracking-[0.3em] text-court">LETSCOK</p>
        <h1 className="mt-2 text-4xl font-bold">렛츠콕 관제판</h1>
        <p className="mt-2 text-dim">운영진 패스코드를 입력해주세요</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="패스코드"
          className="h-14 rounded-xl border border-line bg-panel px-5 text-lg outline-none focus:border-court"
        />
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="h-14 rounded-xl bg-court text-lg font-bold text-bg disabled:opacity-50"
        >
          {busy ? '확인 중...' : '입장'}
        </button>
        {error && <p className="text-center text-sm text-coral">{error}</p>}
      </div>
    </main>
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
        <p className="text-sm font-medium tracking-[0.3em] text-court">LETSCOK</p>
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
    void run(() => api(`/sessions/${session.id}/close`, { method: 'PATCH', admin: true }));
  };

  return (
    <main className="fade-in flex h-dvh flex-col p-4">
      {/* 헤더 */}
      <header className="flex items-center gap-4 pb-3">
        <h1 className="text-xl font-bold">
          렛츠콕 <span className="text-court">관제판</span>
        </h1>
        <p className="text-sm text-dim">
          {session.date} · 출석 {presentCount}명
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCourtsOpen((v) => !v)}
            className={`h-10 rounded-lg border px-4 text-sm font-medium ${
              courtsOpen ? 'border-court text-court' : 'border-line text-dim'
            }`}
          >
            코트 관리
          </button>
          <button
            onClick={closeSession}
            className={`h-10 rounded-lg border px-4 text-sm font-medium ${
              confirmClose ? 'border-coral bg-coral/15 text-coral' : 'border-line text-dim'
            }`}
          >
            {confirmClose ? '한 번 더 누르면 종료' : '모임 종료'}
          </button>
          <button onClick={onLogout} className="h-10 px-2 text-sm text-faint">
            잠금
          </button>
        </div>
      </header>

      {courtsOpen && <CourtsManager sessionId={session.id} courts={courts} playingByCourt={playingByCourt} run={run} />}

      {/* 3구역 */}
      <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_1fr_1fr] gap-3">
        <Zone title="게임 중" accent="text-court" count={playingByCourt.size}>
          {courts.length === 0 && <Empty>코트 관리에서 사용할 코트를 등록해주세요</Empty>}
          <AnimatePresence initial={false}>
            {courts.map((court) => (
              <CourtCard
                key={court.id}
                court={court}
                game={playingByCourt.get(court.id)}
                now={now}
                run={run}
              />
            ))}
          </AnimatePresence>
        </Zone>

        <Zone title="대기 조합" accent="text-amber" count={queuedGames.length}>
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
              />
            ))}
          </AnimatePresence>
        </Zone>

        <Zone title="대기 인원" accent="text-ink" count={waiting.length}>
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
          {leftCount > 0 && (
            <p className="pt-2 text-center text-xs text-faint">퇴장 {leftCount}명</p>
          )}
          {/* 조합 만들기 바 */}
          <div className="sticky bottom-0 mt-auto flex gap-2 pt-2">
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
          </div>
        </Zone>
      </div>

      {recommendOpen && (
        <RecommendModal
          sessionId={session.id}
          run={run}
          busy={busy}
          onClose={() => setRecommendOpen(false)}
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

function RecommendModal({
  sessionId,
  run,
  busy,
  onClose,
}: {
  sessionId: string;
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<IGameRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCandidates(null);
    setError(null);
    try {
      setCandidates(
        await api<IGameRecommendation[]>(`/sessions/${sessionId}/game-recommendations`, {
          admin: true,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '추천을 불러오지 못했습니다.');
    }
  }, [sessionId]);
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
        className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-panel p-5"
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
          {!error && candidates === null && (
            <p className="py-10 text-center text-sm text-dim">추천 계산 중...</p>
          )}
          {candidates?.length === 0 && (
            <p className="py-10 text-center text-sm text-faint">
              추천할 미배정 대기 인원이 없어요
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
                  <div className="flex items-baseline gap-2">
                    <span className={`font-bold ${meta.text}`}>{meta.label}</span>
                    <span className="text-[11px] text-faint">{meta.desc}</span>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {rec.players.map((player) => (
                      <div key={player.attendanceId} className="flex items-center gap-1.5 text-sm">
                        <GradeBadge grade={player.grade} />
                        <span className="truncate font-medium">{player.name}</span>
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

// ===== 구역 공통 =====

function Zone({
  title,
  accent,
  count,
  children,
}: {
  title: string;
  accent: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-panel/70">
      <h2 className={`flex items-baseline gap-2 px-4 pt-3 pb-2 text-sm font-bold ${accent}`}>
        {title}
        <span className="tabular font-mono text-xs text-faint">{count}</span>
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {children}
      </div>
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
}: {
  court: ICourt;
  game?: IGame;
  now: number;
  run: (a: () => Promise<unknown>) => Promise<void>;
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
}: {
  game: IGame;
  order: number;
  neighborUp?: IGame;
  neighborDown?: IGame;
  idleCourts: ICourt[];
  overlapIds: Set<string>;
  run: (a: () => Promise<unknown>) => Promise<void>;
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
}: {
  attendance: IAttendance;
  now: number;
  selected: boolean;
  onToggle: () => void;
  run: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard
      onClick={onToggle}
      className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 transition-colors ${
        selected ? 'border-amber bg-amber/10' : 'border-line bg-panel2'
      }`}
    >
      <GradeBadge grade={member.grade} />
      <span className="font-medium">{member.name}</span>
      {member.isGuest && <span className="text-[10px] text-sky">게스트</span>}
      <span className="tabular ml-auto font-mono text-xs text-dim">
        {attendance.gamesPlayed}게임 · {formatWaitingMinutes(attendance.waitingSince, now)}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation(); // 행 선택 토글과 분리
          void run(() =>
            api(`/attendances/${attendance.id}/leave`, { method: 'PATCH', admin: true }),
          );
        }}
        title="퇴장 처리"
        className="h-8 w-8 rounded-lg text-faint hover:text-coral"
      >
        ✕
      </button>
    </MotionCard>
  );
}
