'use client';

// 관제판 자석판 끌기 — 명단의 사람을 조합 칸·새 조합 자리·코트 카드의 사람 위로 끌어다 놓는다(태블릿 이상)
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
};

// 놓는 곳
export type DropTarget =
  | { kind: 'new-game' } // 대기 조합 맨 아래 새 조합 자리
  | { kind: 'slot'; gameId: string } // 빈칸
  | { kind: 'player'; gameId: string; attendanceId: string } // 찬 칸(교체)
  | { kind: 'card'; gameId: string; full: boolean } // 카드의 칸 밖 여백 — 빈칸 있는 카드면 빈칸에 넣고, 아니면 아무 일 없음
  | { kind: 'roster' }; // 명단 구역 — 카드에서 끌어낸 사람을 빼기

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

// 손가락 아래 놓을 곳이 겹치면(카드 안의 칸) 가장 작은 것 — 칸이 카드보다 우선
const smallestUnderPointer: CollisionDetection = (args) => {
  const area = (id: string | number) => {
    const rect = args.droppableRects.get(id);
    return rect ? rect.width * rect.height : Infinity;
  };
  return pointerWithin(args).sort((a, b) => area(a.id) - area(b.id));
};

export function BoardDnd({
  onDrop,
  children,
}: {
  onDrop: (person: DragPerson, target: DropTarget | null) => void; // target=null: 아무 데도 아닌 곳
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_DISTANCE_PX } }),
    useSensor(TouchSensor, { activationConstraint: { delay: LONG_PRESS_MS, tolerance: TOUCH_TOLERANCE_PX } }),
  );
  const [active, setActive] = useState<DragPerson | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActive(event.active.data.current as DragPerson);
    navigator.vibrate?.(15); // 안드로이드: 집어 들었다는 신호(아이폰은 무시)
  }, []);
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActive(null);
      const person = event.active.data.current as DragPerson | undefined;
      if (person) onDrop(person, (event.over?.data.current as DropTarget | undefined) ?? null);
    },
    [onDrop],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={smallestUnderPointer}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      {children}
      {mounted &&
        createPortal(
          <DragOverlay dropAnimation={null} zIndex={60}>
            {active && (
              <div className="flex h-10 items-center gap-1.5 rounded-xl border border-amber bg-panel px-3 text-sm shadow-xl">
                <GradeBadge grade={active.grade} />
                <span className="font-bold">{active.name}</span>
                <GenderMarker gender={active.gender} />
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

// 놓는 곳 — 끄는 중에 손가락이 올라오면 강조
export function useDropTarget(id: string, target: DropTarget, enabled: boolean) {
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled: !enabled });
  const { active } = useDndContext();
  return {
    ref: setNodeRef,
    dragging: enabled && active !== null, // 무언가 끄는 중 — 놓을 수 있는 곳을 미리 표시할 때
    overCls: enabled && isOver ? 'ring-2 ring-court ring-offset-1 ring-offset-bg' : '',
  };
}

// 끌기용 ref와 놓기용 ref를 한 요소에 같이 붙일 때
export function mergeRefs<T>(...refs: ((node: T | null) => void)[]) {
  return (node: T | null) => refs.forEach((ref) => ref(node));
}
