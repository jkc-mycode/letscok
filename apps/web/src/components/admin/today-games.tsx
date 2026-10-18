'use client';

import { IHistorySessionDetail, ISessionSnapshot, matchesName } from '@letscok/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { ClearableInput } from '@/components/clearable-input';
import { GradeBadge } from '@/components/badges';
import { useLongPress } from '@/components/admin/board-ui';
import { api, ApiError } from '@/lib/api';

// 오늘 게임 기록 — 끝난 게임 목록

// 완료(FINISHED) 게임만 — 진행 중은 코트 구역에 이미 보이므로 중복 노출 안 함
// 서버는 히스토리 상세 API 재사용 (OPEN 세션에도 동작, 별도 엔드포인트 안 만듦)
// 줄을 길게 누르면 확인 창에서 코트를 골라 게임 중으로 되돌린다(시작 시각 그대로) — 종료 직후 [되돌리기] 알림을 놓쳤을 때
export function TodayGamesModal({
  sessionId,
  snapshot,
  onClose,
  onReopen,
}: {
  sessionId: string;
  snapshot: ISessionSnapshot;
  onClose: () => void;
  onReopen: (game: { id: string; no: number }, court: { id: string; courtNo: number }) => void;
}) {
  const [pending, setPending] = useState<GameItem | null>(null); // 길게 눌러 확인 중인 게임
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
    return numbered.filter((game) => game.players.some((player) => matchesName(player.name, q)));
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
      {pending ? (
        <ReopenConfirm
          game={pending}
          snapshot={snapshot}
          timeOf={timeOf}
          onCancel={() => setPending(null)}
          onConfirm={(court) => onReopen({ id: pending.id, no: pending.no }, court)}
        />
      ) : (
        <>
      <p className="pb-2 text-xs text-faint">잘못 종료한 게임은 길게 누르면 코트를 골라 시간 그대로 게임 중으로 되돌려요</p>
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
            <GameRow key={game.id} game={game} q={q} timeOf={timeOf} onLongPress={() => setPending(game)} />
          ))}
        </ul>
      </div>
        </>
      )}
    </Sheet>
  );
}

type GameItem = IHistorySessionDetail['games'][number] & { no: number };

// 한 줄 — 코트에서 끝난 게임만 길게 누르기로 되돌릴 수 있다
function GameRow({
  game,
  q,
  timeOf,
  onLongPress,
}: {
  game: GameItem;
  q: string;
  timeOf: (iso: string | null) => string;
  onLongPress: () => void;
}) {
  const reopenable = game.courtNo != null;
  const { handlers } = useLongPress(onLongPress, reopenable, 600);
  return (
    <li
      {...handlers}
      className={`flex items-center gap-3 rounded-xl bg-panel2 px-4 py-2.5 ${reopenable ? 'cursor-pointer select-none active:bg-panel' : ''}`}
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
                q && matchesName(player.name, q) ? 'font-bold text-court' : 'font-medium'
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
  );
}

// 되돌리기 확인 — 어느 코트로 살릴지 고른다. 원래 코트가 비어 있으면 원래 코트, 아니면 첫 빈 코트를 먼저 골라 둔다
// 고를 수 없는 코트: 게임 중, 다른 모임 차례(원래 코트는 종료 때 차례를 넘겼어도 되돌리면 우리 차례로 돌아와 고를 수 있다)
function ReopenConfirm({
  game,
  snapshot,
  timeOf,
  onCancel,
  onConfirm,
}: {
  game: GameItem;
  snapshot: ISessionSnapshot;
  timeOf: (iso: string | null) => string;
  onCancel: () => void;
  onConfirm: (court: { id: string; courtNo: number }) => void;
}) {
  const busyCourts = new Set(snapshot.games.filter((g) => g.status === 'PLAYING').map((g) => g.courtId));
  const courts = [...snapshot.courts]
    .sort((a, b) => a.courtNo - b.courtNo)
    .map((court) => {
      const original = court.courtNo === game.courtNo;
      const blocked = busyCourts.has(court.id) ? '게임 중' : court.isShared && !court.ourTurn && !original ? '다른 모임 차례' : null;
      return { court, original, blocked };
    });
  const firstFree = courts.find((c) => c.original && !c.blocked) ?? courts.find((c) => !c.blocked);
  const [selectedId, setSelectedId] = useState<string | null>(firstFree?.court.id ?? null);
  const selected = courts.find((c) => c.court.id === selectedId && !c.blocked)?.court;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-body font-bold">#{game.no} 게임을 다시 게임 중으로 옮길까요?</p>
        <p className="mt-1 text-sm text-dim">
          {game.players.map((p) => p.name).join(' · ')}
        </p>
        <p className="mt-1 text-xs text-faint">
          {timeOf(game.startedAt)}에 시작한 시간이 그대로 이어져요 · 원래 {game.courtNo}번 코트
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-dim">어느 코트로 옮길까요?</p>
        {courts.length === 0 && <p className="text-sm text-faint">등록된 코트가 없어요</p>}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {courts.map(({ court, original, blocked }) => (
            <button
              key={court.id}
              disabled={blocked !== null}
              onClick={() => setSelectedId(court.id)}
              className={`flex h-14 cursor-pointer flex-col items-center justify-center rounded-xl border text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                selectedId === court.id && !blocked ? 'border-court bg-court/15 font-bold text-court' : 'border-line bg-panel2'
              }`}
            >
              <span>{court.courtNo}번{original ? ' (원래)' : ''}</span>
              {blocked && <span className="text-[0.6875rem] text-faint">{blocked}</span>}
            </button>
          ))}
        </div>
        {courts.length > 0 && !firstFree && <p className="mt-2 text-xs text-coral">빈 코트가 없어요</p>}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="h-11 flex-1 cursor-pointer rounded-xl bg-panel2 text-sm font-medium">
          취소
        </button>
        <button
          disabled={!selected}
          onClick={() => selected && onConfirm({ id: selected.id, courtNo: selected.courtNo })}
          className="h-11 flex-[2] cursor-pointer rounded-xl bg-court text-sm font-bold text-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {selected ? `${selected.courtNo}번 코트 게임 중으로 옮기기` : '게임 중으로 옮기기'}
        </button>
      </div>
    </div>
  );
}
