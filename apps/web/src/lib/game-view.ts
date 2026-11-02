import { GAME_SIZE, IGame } from '@letscok/shared-types';

// 게임 목록에서 보드마다 꺼내 쓰는 계산 — 관제판·모임원 화면·전광판이 같은 기준을 보게 한 곳에 둔다

// 4명이 다 찬 조합 — 코트 배정·모임원 앱 노출·빈 코트 채우기는 이것만(서버와 같은 기준)
export function isFullGame(game: IGame): boolean {
  return (game.players?.length ?? 0) >= GAME_SIZE;
}

// 코트별 지금 뛰는 게임
export function playingGamesByCourt(games: IGame[]): Map<string, IGame> {
  const map = new Map<string, IGame>();
  for (const game of games) {
    if (game.status === 'PLAYING' && game.courtId) map.set(game.courtId, game);
  }
  return map;
}

// 중복 대기 허용 — 두 개 이상의 대기 조합에 들어간 사람 (카드에 "겹침" 표시)
export function overlappingAttendanceIds(queuedGames: IGame[]): Set<string> {
  const counts = new Map<string, number>();
  for (const game of queuedGames) {
    for (const player of game.players ?? []) {
      counts.set(player.attendanceId, (counts.get(player.attendanceId) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count >= 2).map(([id]) => id));
}
