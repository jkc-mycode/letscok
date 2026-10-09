'use client';

// 관제판 자석판 끌기 — 명단의 사람을 조합 칸·새 조합 자리·코트 카드의 사람 위로 끌어다 놓는다(태블릿 이상)
// 대기 조합 카드는 손잡이(⠿)로 끌어 다른 조합 위에 놓으면 그 순서로, 빈 코트에 놓으면 배정(코트는 태블릿 이상)
// 끄는 동안 손가락을 따라오는 이름표는 body에 띄운다: 관제판 <main>은 fade-in(transform)이 걸려 있어
// 그 안의 fixed 요소는 화면 기준이 아니게 된다(Sheet·Toast와 같은 이유)

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Gender, Grade } from '@letscok/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GenderMarker, GradeBadge } from '@/components/badges';

// 끄는 것 — 사람 한 명. fromGameId = 대기 조합 카드에서 끌어낸 경우 그 조합(명단에서 끌면 null)
export type DragPerson = {
  kind: 'person';
  attendanceId: string;
  name: string;
  grade: Grade;
  gender: Gender | null;
  fromGameId: string | null;
  playing: boolean; // 지금 다른 코트에서 게임 중 — 게임 중인 코트엔 넣을 수 없다(동시에 한 곳만)
};

// 끄는 것 — 대기 조합 카드(손잡이로)
export type DragGame = {
  kind: 'game';
  gameId: string;
  order: number; // "다음 게임 N"
  names: string[];
  full: boolean;
  blocked: boolean; // 다른 코트에서 아직 게임 중인 사람이 있다 — 코트에 놓을 수 없다
};

export type DragItem = DragPerson | DragGame;

// 놓는 곳
export type DropTarget =
  | { kind: 'new-game' } // 대기 조합 맨 아래 새 조합 자리
  | ({ kind: 'slot'; slot: number } & GameRef) // 빈칸 — slot = 게임 안 자리(0·1 한 팀, 2·3 상대)
  | ({ kind: 'player'; attendanceId: string } & GameRef) // 찬 칸(교체)
  | ({ kind: 'card'; full: boolean; queued: boolean } & GameRef) // 카드 여백 — 사람: 빈칸 있으면 넣기 / 조합: 대기 조합이면 그 자리로 순서 이동
  | { kind: 'roster' } // 명단 구역 — 카드에서 끌어낸 사람을 빼기
  | { kind: 'court'; courtId: string }; // 빈 코트 — 조합 카드를 놓으면 배정

// 칸·카드가 속한 게임 — 놓기 전에 서버가 거절할 조합을 미리 가리는 데 쓴다
export type GameRef = {
  gameId: string;
  memberIds: string[]; // 그 게임에 든 사람(출석 id)
  playing: boolean; // 코트에서 게임 중
};

// 끄는 것을 이 곳이 어떻게 받나
// yes = 놓으면 동작, noop = 받기만 하고 아무 일 없음(강조 안 함), no = 놓는 곳이 아님
// noop이 필요한 이유: 받지 않으면 "아무 데도 아닌 곳"이 되어, 카드에서 끌어낸 사람이 원래 조합에서 빠져 버린다
// 놓아도 서버가 거절할 곳(이미 든 조합, 게임 중인 사람을 게임 중 코트에, 아직 못 뛰는 조합을 코트에)은 미리 noop·no로 가린다
type Judgement = 'yes' | 'noop' | 'no';
function judge(item: DragItem, target: DropTarget): Judgement {
  if (item.kind === 'game') {
    if (target.kind === 'court') return item.full && !item.blocked ? 'yes' : 'no';
    if (target.kind !== 'card' || !target.queued) return 'no';
    return target.gameId === item.gameId ? 'noop' : 'yes';
  }
  if (target.kind === 'court') return 'no';
  if (target.kind === 'new-game' || target.kind === 'roster') return 'yes';
  if (target.gameId === item.fromGameId) {
    // 같은 카드 안 — 다른 사람 위·빈칸이면 자리 바꾸기(팀), 자기 자신·카드 여백은 제자리
    if (target.kind === 'slot') return 'yes';
    if (target.kind === 'player' && target.attendanceId !== item.attendanceId) return 'yes';
    return 'noop';
  }
  if (target.memberIds.includes(item.attendanceId)) return 'noop'; // 이미 든 조합
  if (target.playing && item.playing) return 'noop'; // 다른 코트에서 게임 중인 사람을 게임 중 코트에
  if (target.kind === 'card' && target.full) return 'noop'; // 다 찬 카드 여백 — 사람 위에 놓아야 교체
  return 'yes';
}

const LONG_PRESS_MS = 200; // 터치는 살짝 길게 눌러야 끌기 시작 — 짧게 누르면 선택, 밀면 스크롤
const TOUCH_TOLERANCE_PX = 5; // 길게 누르는 동안 이보다 움직이면 스크롤로 본다
const MOUSE_DISTANCE_PX = 5; // 마우스는 이만큼 움직이면 끌기(클릭과 구분)

// 태블릿 이상(md)에서만 끈다 — 폰은 구역이 한 번에 하나라 다른 구역으로 끌어다 놓을 수 없다
export function useBoardDragEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return enabled;
}

// 손가락 아래 놓을 곳이 겹치면(카드 안의 칸) 가장 작은 것 — 칸이 카드보다 우선. 지금 끄는 것을 받지 않는 곳은 뺀다
const smallestUnderPointer: CollisionDetection = (args) => {
  const item = args.active.data.current as DragItem | undefined;
  const droppableContainers = args.droppableContainers.filter((container) => {
    const target = container.data.current as DropTarget | undefined;
    return !!item && !!target && judge(item, target) !== 'no';
  });
  const area = (id: string | number) => {
    const rect = args.droppableRects.get(id);
    return rect ? rect.width * rect.height : Infinity;
  };
  return pointerWithin({ ...args, droppableContainers }).sort((a, b) => area(a.id) - area(b.id));
};

export function BoardDnd({
  onDrop,
  onDraggingChange,
  children,
}: {
  onDrop: (item: DragItem, target: DropTarget | null) => void; // target=null: 아무 데도 아닌 곳
  onDraggingChange?: (dragging: boolean) => void; // 폰 구역 스와이프가 끄는 동안 끼어들지 않게
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_DISTANCE_PX } }),
    useSensor(TouchSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: TOUCH_TOLERANCE_PX } }),
  );
  const [active, setActive] = useState<DragItem | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      setActive(event.active.data.current as DragItem);
      onDraggingChange?.(true);
      navigator.vibrate?.(15); // 안드로이드: 집어 들었다는 신호(아이폰은 무시)
    },
    [onDraggingChange],
  );
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActive(null);
      onDraggingChange?.(false);
      const item = event.active.data.current as DragItem | undefined;
      const target = (event.over?.data.current as DropTarget | undefined) ?? null;
      if (!item || (target && judge(item, target) === 'noop')) return; // 제자리·못 놓는 곳 — 그대로
      if (target) navigator.vibrate?.(10); // 놓았다는 신호(안드로이드)
      onDrop(item, target);
    },
    [onDrop, onDraggingChange],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={smallestUnderPointer}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        onDraggingChange?.(false);
      }}
    >
      {children}
      {mounted &&
        createPortal(
          <DragOverlay dropAnimation={null} zIndex={60}>
            {active?.kind === 'person' && (
              <div className="flex h-10 items-center gap-1.5 rounded-xl border border-amber bg-panel px-3 text-sm shadow-xl">
                <GradeBadge grade={active.grade} />
                <span className="font-bold">{active.name}</span>
                <GenderMarker gender={active.gender} />
              </div>
            )}
            {active?.kind === 'game' && (
              <div className="w-64 rounded-xl border border-amber bg-panel p-3 text-sm shadow-xl">
                <p className="font-bold text-amber">다음 게임 {active.order}</p>
                <p className="mt-1 truncate text-dim">{active.names.join(', ') || '빈 조합'}</p>
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

// 사람 끌기 — 반환한 ref·props를 그 사람 줄(칸)에 붙인다. 끄는 중엔 원래 자리는 흐리게
export function usePersonDrag(person: DragPerson, enabled: boolean) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${person.fromGameId ?? 'roster'}:${person.attendanceId}`,
    data: person,
    disabled: !enabled,
  });
  return {
    ref: setNodeRef,
    props: enabled
      ? {
          ...attributes,
          ...listeners,
          // 길게 누를 때 안드로이드 글자 선택·아이폰 미리보기 메뉴가 뜨지 않게
          style: { WebkitTouchCallout: 'none' } as React.CSSProperties,
        }
      : {},
    dragCls: enabled ? `select-none ${isDragging ? 'opacity-40' : ''}` : '',
  };
}

// 조합 카드 끌기 — 손잡이(⠿)에 ref·props를 붙인다. 카드 전체가 아니라 손잡이인 것은 카드 안의 사람 끌기와 겹치지 않게
export function useGameDrag(game: DragGame, enabled: boolean) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `game:${game.gameId}`,
    data: game,
    disabled: !enabled,
  });
  return {
    ref: setNodeRef,
    props: enabled
      ? { ...attributes, ...listeners, style: { WebkitTouchCallout: 'none' } as React.CSSProperties }
      : {},
    isDragging,
  };
}

function activeItem(active: Active | null): DragItem | null {
  return (active?.data.current as DragItem | undefined) ?? null;
}

// 놓는 곳 — 지금 끄는 것을 받는 곳일 때만 미리 표시(dragging)하고, 손가락이 올라오면 강조(overCls)
export function useDropTarget(id: string, target: DropTarget, enabled: boolean) {
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled: !enabled });
  const item = activeItem(useDndContext().active);
  const relevant = enabled && item !== null && judge(item, target) === 'yes';
  return {
    ref: setNodeRef,
    dragging: relevant,
    overCls: relevant && isOver ? 'ring-2 ring-court ring-offset-1 ring-offset-bg' : '',
  };
}

// 끌기용 ref와 놓기용 ref를 한 요소에 같이 붙일 때
export function mergeRefs<T>(...refs: ((node: T | null) => void)[]) {
  return (node: T | null) => refs.forEach((ref) => ref(node));
}
