import { IHistoryAttendee } from '@letscok/shared-types';

// 모임 마무리 카톡 문구 — 지난 기록 상세(GET /history/sessions/:id) 데이터로 만든다. 정산 문구와 같은 방식

const TOP_LIMIT = 5; // 동점이 많아도 이름은 이만큼만, 나머지는 "외 N명"

// "2026-10-05" → "10월 5일"
const monthDay = (date: string) => {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일`;
};

// 같은 날 모임을 가르는 꼬리표 — 여복·남복처럼 이름이 있으면 이름, 없으면 시작 순서 'N부', 하루 한 모임이면 null
export function sessionTag({ part, label }: { part: number | null; label: string | null }): string | null {
  return label ?? (part ? `${part}부` : null);
}

// 많이 뛴 사람 — 3위의 게임 수 이상인 사람을 모두(동점 포함), 0게임은 제외
export function topPlayers(attendees: IHistoryAttendee[]): IHistoryAttendee[] {
  const played = [...attendees].filter((a) => a.gamesPlayed > 0).sort((a, b) => b.gamesPlayed - a.gamesPlayed);
  if (played.length === 0) return [];
  const threshold = played[Math.min(2, played.length - 1)].gamesPlayed;
  return played.filter((a) => a.gamesPlayed >= threshold);
}

export function sessionReportText({
  date,
  tag,
  attendeeCount,
  gameCount,
  attendees,
  showSummary,
  showTop,
  closing,
}: {
  date: string;
  tag: string | null; // sessionTag — "2부"·"남복"
  attendeeCount: number;
  gameCount: number;
  attendees: IHistoryAttendee[];
  showSummary: boolean;
  showTop: boolean;
  closing: string;
}): string {
  const blocks: string[] = [`🏸 ${monthDay(date)}${tag ? ` ${tag}` : ''} 모임 마무리`];
  if (showSummary) blocks.push(`오늘 ${attendeeCount}명이 함께했고 총 ${gameCount}게임을 쳤어요!`);
  const top = topPlayers(attendees);
  if (showTop && top.length > 0) {
    const names = top.slice(0, TOP_LIMIT).map((a) => `${a.name} ${a.gamesPlayed}게임`);
    const rest = top.length - TOP_LIMIT;
    blocks.push(`🔥 오늘 가장 많이 뛴 분\n -> ${names.join(', ')}${rest > 0 ? ` 외 ${rest}명` : ''}`);
  }
  if (closing.trim()) blocks.push(closing.trim());
  return blocks.join('\n\n');
}

// "11:20" — 게임 시각은 그날 안에서만 의미 있으므로 시:분만
export function timeLabel(iso: string | null) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
