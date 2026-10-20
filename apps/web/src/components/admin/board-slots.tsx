'use client';

import { GAME_SIZE, ICourt, IGame } from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { mergeRefs, TEMP_GAME_PREFIX, useDropTarget, usePersonDrag, type GameRef } from '@/components/board-dnd';
import { gamePartnerPeople, PartnerNote, PersonName } from '@/components/badges';
import { useLongPress } from '@/components/admin/board-ui';

// 조합·코트 카드 안의 4자리(윗줄 팀 대 아랫줄 팀)와 끌어 놓기 자리

// 조합 카드 안 조작(자리 바꾸기·빼기) — 누르자마자 반영하는 BoardBody의 함수를 카드 칸까지 내려 준다
export interface SlotActions {
  moveSlot: (gameId: string, attendanceId: string, slot: number) => void;
  removePlayer: (gameId: string, attendanceId: string) => void;
}

// 놓는 곳이 속한 게임 정보(끄는 동안 못 놓을 곳을 미리 가리는 용도). 게임이 없는 빈 코트 카드는 빈 값
export function gameRef(game?: IGame): GameRef {
  return {
    gameId: game?.id ?? '',
    memberIds: (game?.players ?? []).map((p) => p.attendanceId),
    playing: game?.status === 'PLAYING',
  };
}

// 4명이 다 찬 조합 — 코트 배정·모임원 앱 노출·빈 코트 채우기는 이것만(서버와 같은 기준)
export function isFullGame(game: IGame): boolean {
  return (game.players?.length ?? 0) >= GAME_SIZE;
}

// 사람마다 지금 있는 곳 — 대기 조합 순번들("조합 2, 3") 또는 코트("1번 코트")
export function buildPlaceLabels(
  queuedGames: IGame[],
  playingByCourt: Map<string, IGame>,
  courts: ICourt[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const court of courts) {
    for (const player of playingByCourt.get(court.id)?.players ?? []) {
      labels.set(player.attendanceId, `${court.courtNo}번 코트`);
    }
  }
  const orders = new Map<string, number[]>();
  queuedGames.forEach((game, index) => {
    for (const player of game.players ?? []) {
      orders.set(player.attendanceId, [...(orders.get(player.attendanceId) ?? []), index + 1]);
    }
  });
  for (const [id, list] of orders) {
    if (!labels.has(id)) labels.set(id, `조합 ${list.join(', ')}`);
  }
  return labels;
}

// 조합·코트 카드의 4칸 — 사람 칸은 끌어다 놓기의 대상(교체), 대기 조합의 사람은 끌어서 옮기거나 떼어 낼 수 있다
// 빈칸 있는 조합: 이름 옆 ✕(빼기) + 빈칸 [+ 넣기](사람 고르기 시트, 끌어다 놓기도 됨)
export function BoardSlots({
  game,
  overlapIds,
  slotActions,
  dragEnabled,
  onFillSlot,
}: {
  game: IGame;
  overlapIds?: Set<string>;
  slotActions: SlotActions;
  dragEnabled: boolean;
  onFillSlot?: () => void;
}) {
  const players = game.players ?? [];
  const queued = game.status === 'QUEUED';
  const draft = queued && !isFullGame(game);
  // 자리 바꾸기 — 길게 눌러 고른 사람(끌 수 없는 칸: 폰 전체·태블릿 게임 중 코트). 다른 사람·빈칸을 누르면 그 자리로
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (picked && !players.some((p) => p.attendanceId === picked)) setPicked(null); // 그 사람이 빠지면 선택도 푼다
  }, [players, picked]);
  const moveTo = (slot: number) => {
    const attendanceId = picked;
    setPicked(null);
    if (!attendanceId) return;
    slotActions.moveSlot(game.id, attendanceId, slot);
  };
  // 자리 순서대로 — 윗줄(자리 0·1)이 한 팀, 아랫줄(2·3)이 상대
  const cell = (slot: number) => {
    const player = players.find((p) => p.slot === slot);
    if (player?.attendance?.member) {
      const isPicked = picked === player.attendanceId;
      return (
        <SlotPerson
          key={player.id}
          game={game}
          player={player}
          overlap={overlapIds?.has(player.attendanceId) ?? false}
          removable={draft}
          onRemove={() => slotActions.removePlayer(game.id, player.attendanceId)}
          dragEnabled={dragEnabled}
          picked={isPicked}
          pickTarget={picked !== null && !isPicked}
          onLongPress={() => setPicked(player.attendanceId)}
          onTap={picked === null ? undefined : isPicked ? () => setPicked(null) : () => moveTo(slot)}
        />
      );
    }
    if (!queued) return <div key={`none-${slot}`} />;
    return (
      <EmptySlot
        key={`empty-${slot}`}
        slot={slot}
        game={game}
        dragEnabled={dragEnabled}
        pickTarget={picked !== null}
        onClick={picked !== null ? () => moveTo(slot) : onFillSlot}
      />
    );
  };
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5">
      {cell(0)}
      {cell(1)}
      <div className="col-span-2 flex h-4 items-center gap-2 text-caption font-bold text-faint" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        VS
        <span className="h-px flex-1 bg-line" />
      </div>
      {cell(2)}
      {cell(3)}
      {picked && (
        <div className="col-span-2 flex items-center gap-2 rounded-lg bg-amber/10 px-2.5 py-1.5 text-caption text-amber">
          <span className="min-w-0 flex-1">바꿀 사람이나 빈칸을 누르세요</span>
          <button onClick={() => setPicked(null)} className="tap shrink-0 font-bold">
            취소
          </button>
        </div>
      )}
      <PartnerNote people={gamePartnerPeople(game)} className="col-span-2 mt-0.5" />
    </div>
  );
}

function SlotPerson({
  game,
  player,
  overlap,
  removable,
  onRemove,
  dragEnabled,
  picked,
  pickTarget,
  onLongPress,
  onTap,
}: {
  game: IGame;
  player: NonNullable<IGame['players']>[number];
  overlap: boolean;
  removable: boolean;
  onRemove: () => void; // ✕ — 누르자마자 반영
  dragEnabled: boolean;
  picked: boolean; // 자리를 바꾸려고 길게 눌러 고른 사람
  pickTarget: boolean; // 다른 사람이 골라져 있어 이 칸을 누르면 자리가 바뀐다
  onLongPress: () => void;
  onTap?: () => void;
}) {
  const member = player.attendance!.member!;
  const queued = game.status === 'QUEUED';
  // 만드는 중인 조합(임시 카드)의 사람은 끌지 않는다 — 끌어내면 빠지지 않고 복사된다(서버에 아직 뺄 조합이 없음)
  const draggable = dragEnabled && queued && !game.id.startsWith(TEMP_GAME_PREFIX);
  // 대기 조합에 있는데 본인은 다른 코트에서 게임 중 = 미리 짜둔 조합의 차용 인원
  const busyElsewhere = queued && player.attendance?.status === 'PLAYING';
  const drop = useDropTarget(
    `player:${game.id}:${player.attendanceId}`,
    { kind: 'player', attendanceId: player.attendanceId, ...gameRef(game) },
    dragEnabled,
  );
  // 게임 중인 코트의 사람은 끌어내지 않는다(게임을 깨지 않게 — 교체만)
  const drag = usePersonDrag(
    {
      kind: 'person',
      attendanceId: player.attendanceId,
      name: member.name,
      grade: member.grade,
      gender: member.gender,
      fromGameId: game.id,
      playing: player.attendance?.status === 'PLAYING',
    },
    draggable,
  );
  // 끌 수 있는 칸(태블릿 대기 조합)은 길게 누르면 끌기가 시작된다 — 자리 바꾸기는 같은 카드 안에 놓는 것으로
  const press = useLongPress(onLongPress, !draggable);
  return (
    <div
      ref={mergeRefs(drop.ref, drag.ref)}
      {...drag.props}
      {...press.handlers}
      onClick={() => {
        if (press.consumeFired()) return; // 길게 누른 손을 뗄 때의 클릭은 무시
        onTap?.();
      }}
      className={`flex h-10 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg bg-panel px-2 text-sm select-none ${
        picked ? 'ring-2 ring-amber ring-inset' : pickTarget ? 'ring-1 ring-amber/40 ring-inset' : ''
      } ${drag.dragCls} ${drop.overCls}`}
      style={{ WebkitTouchCallout: 'none' }}
    >
      <PersonName person={member} nameClassName="shrink-0 whitespace-nowrap font-medium" guest="short" />
      {busyElsewhere && (
        <span className="min-w-0 truncate rounded bg-coral/15 px-1 py-0.5 text-caption font-medium text-coral">게임 중</span>
      )}
      {!busyElsewhere && overlap && (
        <span
          title="다른 대기 조합에도 포함"
          className="min-w-0 truncate rounded bg-amber/15 px-1 py-0.5 text-caption font-medium text-amber"
        >
          겹침
        </span>
      )}
      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // 칸 누르기(자리 바꾸기)와 분리
            onRemove();
          }}
          aria-label={`${member.name} 빼기`}
          className="tap ml-auto h-7 w-7 shrink-0 rounded text-xs text-dim hover:text-coral"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function EmptySlot({
  slot,
  game,
  dragEnabled,
  pickTarget,
  onClick,
}: {
  slot: number;
  game: IGame;
  dragEnabled: boolean;
  pickTarget: boolean; // 자리를 바꿀 사람이 골라져 있음 — 누르면 이 자리로 옮긴다
  onClick?: () => void;
}) {
  const drop = useDropTarget(`slot:${game.id}:${slot}`, { kind: 'slot', slot, ...gameRef(game) }, dragEnabled);
  return (
    <button
      ref={drop.ref}
      onClick={onClick}
      className={`h-10 rounded-lg border border-dashed text-xs ${
        drop.dragging || pickTarget ? 'border-amber/60 text-amber' : 'border-line text-faint'
      } ${drop.overCls}`}
    >
      {drop.dragging ? '여기에 놓기' : pickTarget ? '이 자리로' : '+ 넣기'}
    </button>
  );
}

// 새 조합 자리 — 대기 조합 맨 아래에 늘 비어 있다. 눌러서 고르거나 사람을 끌어다 놓으면 빈칸 3개짜리 조합이 생긴다
export function NewGameSlot({ dragEnabled, onClick }: { dragEnabled: boolean; onClick: () => void }) {
  const drop = useDropTarget('new-game', { kind: 'new-game' }, dragEnabled);
  return (
    <button
      ref={drop.ref}
      onClick={onClick}
      className={`flex h-14 shrink-0 items-center justify-center rounded-xl border border-dashed text-sm font-medium ${
        drop.dragging ? 'border-amber bg-amber/10 text-amber' : 'border-amber/40 text-amber/80'
      } ${drop.overCls}`}
    >
      {drop.dragging ? '여기에 놓으면 새 조합' : '+ 새 조합'}
    </button>
  );
}

// 명단 구역 — 조합 카드에서 끌어낸 사람을 여기 놓으면 그 조합에서 빠진다(자석 떼기)
export function RosterDrop({
  className,
  dragEnabled,
  children,
}: {
  className: string;
  dragEnabled: boolean;
  children: React.ReactNode;
}) {
  const drop = useDropTarget('roster', { kind: 'roster' }, dragEnabled);
  return (
    <div ref={drop.ref} className={`${className} rounded-2xl ${drop.overCls}`}>
      {children}
    </div>
  );
}
