'use client';

import { GAME_SIZE, ICourt, IGame } from '@letscok/shared-types';
import { useDropTarget, useGameDrag } from '@/components/board-dnd';
import { MotionCard } from '@/components/motion-card';
import { BoardSlots, SlotActions, gameRef, isFullGame } from '@/components/admin/board-slots';
import { ConfirmButton, MoreButton } from '@/components/admin/board-ui';

// 대기 조합 카드

export function QueueCard({
  game,
  order,
  neighborUp,
  neighborDown,
  idleCourts,
  overlapIds,
  onCancel,
  slotActions,
  onMore,
  onPickCourt,
  onAssign,
  onMove,
  onFillSlot,
  onRecommend,
  dragEnabled,
}: {
  game: IGame;
  order: number;
  neighborUp?: IGame;
  neighborDown?: IGame;
  idleCourts: ICourt[];
  overlapIds: Set<string>;
  onCancel: (gameId: string) => void; // 해체 — 누르자마자 대기로(보드가 맡음)
  slotActions: SlotActions;
  onMore: (game: IGame) => void; // [⋯] — 교체·해체 시트(4명 조합)
  onPickCourt: (game: IGame) => void; // 빈 코트가 여럿이면 코트 고르기 시트
  onAssign: (gameId: string, courtId: string) => void; // 빈 코트가 하나면 바로 배정
  onMove: (gameId: string, delta: -1 | 1) => void; // ▲▼ 순서 — 누르자마자 반영
  onFillSlot: (game: IGame) => void; // 빈칸 → 사람 고르기 시트
  onRecommend: (game: IGame) => void; // 짜는 중 조합 → 빈자리 추천
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
            onClick={() => onMove(game.id, -1)}
            disabled={!neighborUp}
            aria-label="위로"
            className="tap h-8 w-8 rounded-lg bg-panel text-dim disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(game.id, 1)}
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
        slotActions={slotActions}
        dragEnabled={dragEnabled}
        onFillSlot={() => onFillSlot(game)}
      />
      {/* 4명 조합: 배정 + [⋯](교체·해체) / 빈칸 조합: 할 일이 해체뿐이라 바로 둔다 */}
      <div className="mt-3 flex gap-1.5">
        {!full ? (
          <button
            onClick={() => onRecommend(game)}
            className="h-10 flex-1 rounded-[10px] bg-court/10 px-2 text-body-sm font-bold text-court"
          >
            빈자리 {GAME_SIZE - (game.players?.length ?? 0)}명 추천
          </button>
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
            onClick={() => onAssign(game.id, available[0].id)}
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
            onConfirm={() => onCancel(game.id)}
            className="h-10 rounded-[10px] px-3 text-body-sm"
            idleCls="text-coral"
          />
        )}
      </div>
    </MotionCard>
  );
}
