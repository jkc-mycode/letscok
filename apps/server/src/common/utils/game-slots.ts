// 게임 안 자리(0~3) — 0·1이 한 팀, 2·3이 상대
// 자리가 비어 있는 행(도입 전 데이터)·겹친 자리는 남는 자리를 들어온 순서대로 채워 본다
export const SLOT_COUNT = 4;

export function withSlots<T extends { slot: number | null }>(players: T[]): (T & { slot: number })[] {
  const taken = new Set<number>();
  const placed: (T & { slot: number })[] = [];
  const unplaced: T[] = [];
  for (const player of players) {
    if (player.slot !== null && player.slot >= 0 && player.slot < SLOT_COUNT && !taken.has(player.slot)) {
      taken.add(player.slot);
      placed.push(player as T & { slot: number });
    } else {
      unplaced.push(player);
    }
  }
  const free = Array.from({ length: SLOT_COUNT }, (_, i) => i).filter((i) => !taken.has(i));
  unplaced.forEach((player, i) => placed.push({ ...player, slot: free[i] ?? SLOT_COUNT + i }));
  return placed.sort((a, b) => a.slot - b.slot);
}

// 비어 있는 자리 — 원하는 자리가 비었으면 그 자리, 아니면 첫 빈자리(없으면 null)
export function pickFreeSlot(players: { slot: number | null }[], wanted?: number): number | null {
  const taken = new Set(withSlots(players).map((p) => p.slot));
  if (wanted !== undefined && wanted >= 0 && wanted < SLOT_COUNT && !taken.has(wanted)) return wanted;
  for (let i = 0; i < SLOT_COUNT; i++) if (!taken.has(i)) return i;
  return null;
}
