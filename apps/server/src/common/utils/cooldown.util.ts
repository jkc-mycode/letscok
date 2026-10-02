// 키별 쿨다운 — 같은 대상을 짧은 시간에 반복 호출하지 못하게 한다 (운영진 호출 연타로 폰이 계속 울리는 것 방지)
// 인메모리라 Render 단일 인스턴스 전제, 재시작 시 초기화 (체크인 코드 잠금과 같은 방식)
export function createCooldown(ms: number) {
  const lastAt = new Map<string, number>();
  return {
    // 쿨다운 중이면 false, 아니면 기록하고 true
    tryAcquire(key: string): boolean {
      const now = Date.now();
      const last = lastAt.get(key);
      if (last !== undefined && now - last < ms) return false;
      lastAt.set(key, now);
      // 기록할 때 만료 항목을 함께 정리해 Map이 무한히 커지지 않게
      for (const [k, at] of lastAt) if (now - at >= ms) lastAt.delete(k);
      return true;
    },
  };
}
