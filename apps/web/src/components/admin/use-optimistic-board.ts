'use client';

import { GAME_SIZE, IFillCourtsResult, IGame, IGameRecommendation, ISessionSnapshot } from '@letscok/shared-types';
import { arrayMove } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isFullGame } from '@/components/admin/board-slots';
import { sortCandidates } from '@/components/admin/roster-sort';
import type { AttendanceChange } from '@/components/admin/action-sheets';
import { TEMP_GAME_PREFIX, type DragItem, type DropTarget } from '@/components/board-dnd';
import { api } from '@/lib/api';
import { useOptimisticMap } from '@/lib/use-optimistic-map';
import type { useToast } from '@/lib/use-toast';

// 관제판 보드의 누르자마자 반영 — 서버 화면 위에 아직 닿지 않은 조작을 덧씌운 화면과, 그 조작(보드 동작)을 함께 들고 있다
// 보드(admin/page)는 화면·시트 상태만 두고 여기서 받은 값과 동작을 그린다. 모임을 바꾸면 보드가 새로 그려져 이 상태도 버려진다

// 누르자마자 보여 주는 새 조합 — 서버 id가 오기 전 임시 id. realId = 빈칸 조합을 한 명씩 채우는 중인 서버 조합
type GamePlayer = NonNullable<IGame['players']>[number];
const playersSignature = (players: GamePlayer[] = []) =>
  players.map((p) => `${p.attendanceId}:${p.slot}`).sort().join(',');
type OptimisticGame = { game: IGame; ids: string[]; realId?: string };
// 조합의 첫 빈자리(0~3) — 서버 pickFreeSlot과 같은 규칙
export const firstFreeSlot = (players: GamePlayer[]) => [0, 1, 2, 3].find((n) => !players.some((p) => p.slot === n));

// 서버 화면에 같은 조합이 실렸는지 — 같은 4명 조합은 서버가 중복으로 막아서 사람 묶음으로 알아볼 수 있다
// 서버 id를 아는 조합은 사람까지 같아야 — 만든 직후 넣기·빼기가 서버에 닿기 전 옛 사람으로 돌아가 보이지 않게
function isSettled(t: OptimisticGame, games: IGame[]): boolean {
  return games.some((g) => {
    const ids = (g.players ?? []).map((p) => p.attendanceId);
    const same = ids.length === t.ids.length && t.ids.every((id) => ids.includes(id));
    if (g.id === t.realId) return same;
    return g.status === 'QUEUED' && same;
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
  // 대기로 돌린 조합은 서버처럼 대기 조합 맨 앞
  let firstOrder = Math.min(1, ...serverGames.map((g) => (g.status === 'QUEUED' ? (g.queueOrder ?? 1) : 1)));
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
      if (ended) return { ...g, status: 'QUEUED' as const, courtId: null, startedAt: null, queueOrder: --firstOrder };
      const assigned = g.status === 'QUEUED' ? optAssign.get(g.id) : undefined;
      return assigned ? { ...g, status: 'PLAYING' as const, courtId: assigned.courtId, startedAt: assigned.startedAt } : g;
    });
  // 대기 조합 목록은 배열 순서대로 그려진다 — 대기로 돌린 조합을 배열에서도 맨 앞으로
  const front = base.filter((g) => g.status === 'QUEUED' && optEnded.get(g.id)?.kind === 'UNASSIGNED');
  const rest = front.length ? base.filter((g) => !front.includes(g)) : base;
  // 만드는 중인 조합 — 다 뺀(해체한) 건 숨기고, 배정을 누른 건 게임 중으로
  const temps = pending
    .filter((t) => (t.game.players?.length ?? 0) > 0)
    .map((t) => {
      const assigned = optAssign.get(t.game.id) ?? (t.realId ? optAssign.get(t.realId) : undefined);
      return assigned ? { ...t.game, status: 'PLAYING' as const, courtId: assigned.courtId, startedAt: assigned.startedAt } : t.game;
    });
  return [...front, ...rest, ...temps];
}

function overlayAttendances(
  serverAttendances: ISessionSnapshot['attendances'],
  serverGames: IGame[],
  games: IGame[], // overlayGames 결과
  { optAssign, optCreated, optEnded, optPlayers }: OptimisticBoard,
): ISessionSnapshot['attendances'] {
  if (optAssign.size === 0 && optCreated.length === 0 && optEnded.size === 0 && optPlayers.size === 0) return serverAttendances;
  // 배정을 누른 조합 — 만드는 중인 조합은 배정 표시가 서버 id로 옮겨 가도 게임 중으로 보인다
  const playing = new Set(
    games
      .filter((g) => optAssign.has(g.id) || (g.status === 'PLAYING' && g.id.startsWith(TEMP_GAME_PREFIX)))
      .flatMap((g) => (g.players ?? []).map((p) => p.attendanceId)),
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

// 조합 카드 안 사람의 상태도 덧씌운 출석대로 — 카드는 이 값으로 '게임 중이라 배정 불가'를 가린다
// (안 맞추면 게임 종료를 눌러도 실시간 화면이 올 때까지 다음 조합의 [배정]이 막혀 있다)
function syncPlayerStatus(
  games: IGame[],
  attendances: ISessionSnapshot['attendances'],
  serverAttendances: ISessionSnapshot['attendances'],
): IGame[] {
  if (attendances === serverAttendances) return games;
  const statusOf = new Map(attendances.map((a) => [a.id, a.status]));
  const stale = (p: GamePlayer) => {
    const status = statusOf.get(p.attendanceId);
    return p.attendance !== undefined && status !== undefined && status !== p.attendance.status;
  };
  return games.map((g) =>
    g.players?.some(stale)
      ? {
          ...g,
          players: g.players.map((p) =>
            stale(p) ? { ...p, attendance: { ...p.attendance!, status: statusOf.get(p.attendanceId)! } } : p,
          ),
        }
      : g,
  );
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

export function useOptimisticBoard({
  snapshot,
  run,
  runParallel,
  showToast,
  hideToast,
}: {
  snapshot: ISessionSnapshot;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  runParallel: (a: () => Promise<unknown>) => Promise<boolean>;
  showToast: ReturnType<typeof useToast>['showToast'];
  hideToast: () => void;
}) {
  const { session } = snapshot;

  // 코트 배정·조합 만들기는 누르자마자 보여 준다 — 서버 응답과 화면 새로고침(두 번 오감)을 기다리면 멈춘 것처럼 보였다.
  // 서버 화면에 실리면 이 표시는 지우고, 실패하면 되돌린다(알림은 runParallel)
  // 막 만든 조합에 배정을 보내는 중 — 서버 화면에 아직 그 조합이 없어도 덧씌움을 지우지 않는다
  const assigningNew = useRef(new Set<string>());
  const [optAssign, assignOpt] = useOptimisticMap<{ courtId: string; startedAt: string }>((id) => {
    if (id.startsWith(TEMP_GAME_PREFIX)) return true; // 만드는 중인 조합 — 서버 id로 옮길 때 직접 지운다
    const server = snapshot.games.find((g) => g.id === id);
    return server ? server.status === 'QUEUED' : assigningNew.current.has(id); // 서버에서 '게임 중'이 되면 지운다
  }, snapshot.games);
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
  const overlaidGames = useMemo(
    () => overlayGames(snapshot.games, { optAssign, optCreated, optEnded, optPlayers }),
    [snapshot.games, optAssign, optCreated, optEnded, optPlayers],
  );
  const attendances = useMemo(
    () =>
      overlayAttendances(snapshot.attendances, snapshot.games, overlaidGames, { optAssign, optCreated, optEnded, optPlayers }),
    [snapshot.attendances, snapshot.games, overlaidGames, optAssign, optCreated, optEnded, optPlayers],
  );
  const games = useMemo(
    () => syncPlayerStatus(overlaidGames, attendances, snapshot.attendances),
    [overlaidGames, attendances, snapshot.attendances],
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
  // 아직 서버에 안 닿은 게임 종료·대기로 — 배정·빈 코트 채우기는 이게 끝난 뒤 보낸다
  // (화면은 종료를 누르자마자 다음 조합을 풀어 주므로, 먼저 닿으면 서버가 '아직 게임 중'으로 거절한다)
  const endingRef = useRef(new Set<Promise<unknown>>());
  const waitForEnds = useCallback(() => Promise.allSettled([...endingRef.current]), []);
  const endGame = useCallback(
    (gameId: string, kind: 'FINISHED' | 'UNASSIGNED'): Promise<boolean> => {
      // 이미 누른 게임·배정이 서버에 아직 안 닿은 게임(종료하면 409)은 무시
      if (optEnded.has(gameId) || optAssign.has(gameId)) return Promise.resolve(false);
      endedOpt.set(gameId, { kind, at: new Date().toISOString() });
      const path = kind === 'FINISHED' ? 'finish' : 'unassign';
      const clearEnded = () => endedOpt.remove(gameId);
      const courtNo = snapshot.courts.find((c) => c.id === games.find((g) => g.id === gameId)?.courtId)?.courtNo;
      // 결과(성공 여부)를 돌려준다 — AI 명령은 서버에 닿은 뒤 다음 단계로 넘어간다(다음 추천이 끝난 사람을 대기로 보게)
      const request = runParallel(() => api(`/games/${gameId}/${path}`, { method: 'PATCH', admin: true }));
      endingRef.current.add(request);
      void request.finally(() => endingRef.current.delete(request));
      return request.then((ok) => {
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
  // 임시 조합 → 서버 조합 id(만들어지면). 만든 직후의 조작(넣기·빼기·배정·해체)은 이걸 기다렸다 보낸다
  const tempReal = useRef(new Map<string, Promise<string | null>>());
  const serverIdOf = useCallback(async (gameId: string) => {
    if (!gameId.startsWith(TEMP_GAME_PREFIX)) return gameId;
    const realId = await tempReal.current.get(gameId);
    if (!realId) throw new Error('조합을 만들지 못해 바꾸지 못했어요');
    return realId;
  }, []);
  const snapshotRef = useRef(snapshot); // 순서 요청이 줄을 서 있다 나갈 때 그때의 서버 화면을 보려고
  snapshotRef.current = snapshot;
  // 카드 사람 목록을 먼저 바꿔 보여 주고 요청을 보낸다 — 카드끼리 옮길 때는 두 카드를 함께(요청 안에서 넣기 → 빼기 차례로)
  // 실패하면 바꾼 카드 모두 서버 화면대로. 결과(성공 여부)를 돌려줘 이어서 할 일을 정할 수 있게
  const patchGames = useCallback(
    (changes: [string, (players: GamePlayer[]) => GamePlayer[]][], request: () => Promise<unknown>) => {
      // 만드는 중인 조합(임시 id)은 임시 카드를 바꾸고, 요청 안에서 serverIdOf로 서버 id를 기다린다
      const ready = changes.every(([gameId]) =>
        gameId.startsWith(TEMP_GAME_PREFIX)
          ? tempReal.current.has(gameId) && gamesRef.current.some((g) => g.id === gameId)
          : snapshot.games.some((g) => g.id === gameId) && gamesRef.current.some((g) => g.id === gameId),
      );
      if (!ready) return Promise.resolve(false);
      // 만드는 중인 조합(임시 카드) — 임시 카드의 사람을 바로 바꾸고, 실패하면 원래대로
      const tempChanges = changes.filter(([gameId]) => gameId.startsWith(TEMP_GAME_PREFIX));
      const tempBefore = new Map<string, OptimisticGame>();
      if (tempChanges.length > 0) {
        setOptCreated((prev) =>
          prev.map((t) => {
            const change = tempChanges.find(([gameId]) => gameId === t.game.id)?.[1];
            if (!change) return t;
            tempBefore.set(t.game.id, t);
            const players = change(t.game.players ?? []);
            return { ...t, ids: players.map((p) => p.attendanceId), game: { ...t.game, players } };
          }),
        );
      }
      const restoreTemps = () =>
        tempBefore.size > 0 && setOptCreated((prev) => prev.map((t) => tempBefore.get(t.game.id) ?? t));
      const serverChanges = changes.filter(([gameId]) => !gameId.startsWith(TEMP_GAME_PREFIX));
      const ids = serverChanges.map(([gameId]) => gameId);
      const patched = serverChanges.map(([gameId, change]) => ({
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
        if (!ok) restoreTemps();
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
    [snapshot.games, runParallel, setOptCreated],
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
        async () =>
          api(`/games/${await serverIdOf(gameId)}/players`, {
            method: 'PATCH',
            admin: true,
            body: { outAttendanceId, inAttendanceId },
          }),
      );
    },
    [snapshot.attendances, patchGames, serverIdOf],
  );
  // 게임 취소·조합 해체 — 사람을 다 뺀 모습(서버처럼 해체)으로 바로 보여 준다. 사람은 다른 조합에 없으면 대기로, 코트는 빈다
  const cancelGame = useCallback(
    (gameId: string) =>
      void patchGames([[gameId, () => []]], async () =>
        api(`/games/${await serverIdOf(gameId)}/cancel`, { method: 'PATCH', admin: true }),
      ),
    [patchGames, serverIdOf],
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
          async () =>
            api(`/games/${await serverIdOf(gameId)}/slots`, { method: 'PATCH', admin: true, body: { attendanceId, slot } }),
        ),
      removePlayer: (gameId: string, attendanceId: string) =>
        patchPlayers(
          gameId,
          (players) => players.filter((p) => p.attendanceId !== attendanceId),
          async () => api(`/games/${await serverIdOf(gameId)}/players/${attendanceId}`, { method: 'DELETE', admin: true }),
        ),
    }),
    [patchPlayers, serverIdOf],
  );
  const assignToCourt = useCallback(
    (gameId: string, courtId: string) => {
      if (optAssign.has(gameId)) return; // 이미 누른 조합
      const temp = gameId.startsWith(TEMP_GAME_PREFIX);
      if (temp && !tempReal.current.has(gameId)) return;
      const value = { courtId, startedAt: new Date().toISOString() };
      assignOpt.set(gameId, value);
      void (async () => {
        let realId = gameId;
        if (temp) {
          // 막 만든 조합 — 서버 id가 오면 덧씌움을 그 id로 옮긴다(임시 카드가 서버 조합으로 바뀌어도 게임 중으로 보이게)
          const created = await tempReal.current.get(gameId);
          if (!created) {
            assignOpt.remove(gameId);
            return;
          }
          realId = created;
          assigningNew.current.add(realId);
          assignOpt.set(realId, value);
          assignOpt.remove(gameId);
        }
        await waitForEnds();
        const ok = await runParallel(() => api(`/games/${realId}/assign`, { method: 'PATCH', admin: true, body: { courtId } }));
        assigningNew.current.delete(realId);
        if (!ok) assignOpt.remove(realId);
      })();
    },
    [optAssign, assignOpt, runParallel, waitForEnds],
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
            const created = await api<IGame>(`/sessions/${session.id}/games`, {
              method: 'POST',
              admin: true,
              body: { attendanceIds: ids },
            });
            resolveReal(created.id);
            setOptCreated((prev) => prev.map((t) => (t.game.id === tempId ? { ...t, realId: created.id } : t)));
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
        await waitForEnds();
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
  // 빈칸 채우기 대상 — 시트에서 만든 새 조합은 서버 조합이 생기기 전까지 임시 카드로 보이므로 서버 id로도 그 임시 카드를 찾는다
  const slotTempOf = (id: string) => optCreated.find((t) => t.game.id === id || t.realId === id);
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

  return {
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
    moveQueue,
    startGame,
    growTemp,
    onDrop,
    fillCourts,
    changeAttendance,
    confirmShuttle,
    slotTempOf,
    addRecommended,
  };
}
