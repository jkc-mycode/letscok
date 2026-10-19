'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 누르자마자 반영하는 표시(id → 누른 값) — 서버 화면이 바뀔 때마다 keep으로 걸러, 서버에 실린 표시는 지운다.
// 실패하면 부르는 쪽이 remove로 되돌린다. 관제판 보드·코트 관리가 같은 모양을 반복하던 것을 하나로
export function useOptimisticMap<V>(keep: (id: string, value: V) => boolean, source: unknown) {
  const [map, setMap] = useState<Map<string, V>>(new Map());
  const keepRef = useRef(keep);
  keepRef.current = keep; // 걸러 낼 때는 그 렌더의 서버 화면 기준
  useEffect(() => {
    setMap((prev) => {
      const next = new Map([...prev].filter(([id, value]) => keepRef.current(id, value)));
      return next.size === prev.size ? prev : next;
    });
  }, [source]);
  const set = useCallback((id: string, value: V) => setMap((prev) => new Map(prev).set(id, value)), []);
  const remove = useCallback(
    (...ids: string[]) =>
      setMap((prev) => {
        if (!ids.some((id) => prev.has(id))) return prev;
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }),
    [],
  );
  const actions = useMemo(() => ({ set, remove }), [set, remove]);
  return [map, actions] as const;
}
