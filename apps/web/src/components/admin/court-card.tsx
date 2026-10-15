'use client';

import { ICourt, IGame } from '@letscok/shared-types';
import { useDropTarget } from '@/components/board-dnd';
import { MotionCard } from '@/components/motion-card';
import { api } from '@/lib/api';
import { formatElapsed } from '@/lib/use-snapshot';
import { BoardSlots, SlotActions, gameRef } from '@/components/admin/board-slots';
import { MoreButton } from '@/components/admin/board-ui';

// 게임 중 코트 카드

// 공유 코트 표시 — 다른 모임과 번갈아 쓰는 코트임을 카드 제목 옆에 알린다
function SharedBadge() {
  return (
    <span className="rounded bg-sky/15 px-1.5 py-0.5 text-caption font-medium text-sky">공유</span>
  );
}

export function CourtCard({
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
