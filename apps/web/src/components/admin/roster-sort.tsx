'use client';

import { IAttendance } from '@letscok/shared-types';
import { GRADES } from '@/components/multi-member-form';

// 사람 목록 정렬(대기 명단·빈칸 채우기·선수 교체 공용) — 모임장·운영진 고정, 그 아래는 고른 기준

// 명단 순서 — 모임장 → 운영진을 맨 위에 고정(현장에서 찾기 쉽게), 그 아래는
// 대기순이면 상태와 상관없이 오래 기다린 순(게임 중은 화면처럼 0분이라 맨 아래),
// 다른 정렬이면 비어 있는 사람 → 조합에 든 사람 → 게임 중 → 휴식 묶음 안에서 고른 기준
const ROLE_RANK: Record<string, number> = { LEADER: 0, MANAGER: 1 };

export const roleRank = (a: IAttendance) => ROLE_RANK[a.member?.role ?? 'MEMBER'] ?? 2;

const ROSTER_RANK: Partial<Record<IAttendance['status'], number>> = {
  CHECKED_IN: 0,
  MATCHED: 1,
  PLAYING: 2,
  RESTING: 3,
};

export function sortRoster(attendances: IAttendance[], sort: RosterSort): IAttendance[] {
  return sortCandidates(
    attendances.filter((a) => a.shuttleConfirmedAt && ROSTER_RANK[a.status] !== undefined),
    sort,
  );
}

// 정렬 기준 — 대기순·이름순·급수순·게임 적은 순(대기순 외에는 같으면 오래 기다린 순)
export type RosterSort = 'WAITING' | 'NAME' | 'GRADE' | 'GAMES';

const ROSTER_SORT_LABEL: Record<RosterSort, string> = {
  WAITING: '대기순',
  NAME: '이름순',
  GRADE: '급수순',
  GAMES: '게임 적은 순',
};

export const ROSTER_SORT_KEY = 'letscok:roster-sort';

export function readRosterSort(): RosterSort {
  try {
    const saved = localStorage.getItem(ROSTER_SORT_KEY);
    if (saved && saved in ROSTER_SORT_LABEL) return saved as RosterSort;
  } catch {
    // 사생활 보호 모드 등 저장소를 못 쓰면 기본값
  }
  return 'WAITING';
}

// 게임 중인 사람은 waitingSince가 시작 전 값 그대로라 화면처럼 0분(지금)으로 본다
const waitStart = (a: IAttendance) => (a.status === 'PLAYING' ? Infinity : new Date(a.waitingSince).getTime());
const waitedLonger = (a: IAttendance, b: IAttendance) => {
  const diff = waitStart(a) - waitStart(b);
  return Number.isNaN(diff) ? 0 : diff; // 둘 다 게임 중이면 Infinity - Infinity
};

export function sortCandidates(attendances: IAttendance[], sort: RosterSort): IAttendance[] {
  const byKey = (a: IAttendance, b: IAttendance) => {
    if (sort === 'NAME') return (a.member?.name ?? '').localeCompare(b.member?.name ?? '', 'ko');
    if (sort === 'GRADE') return GRADES.indexOf(a.member?.grade ?? 'F') - GRADES.indexOf(b.member?.grade ?? 'F');
    if (sort === 'GAMES') return a.gamesPlayed - b.gamesPlayed;
    return 0;
  };
  const byStatus = (a: IAttendance, b: IAttendance) =>
    sort === 'WAITING' ? 0 : (ROSTER_RANK[a.status] ?? 9) - (ROSTER_RANK[b.status] ?? 9);
  return [...attendances].sort(
    (a, b) => roleRank(a) - roleRank(b) || byStatus(a, b) || byKey(a, b) || waitedLonger(a, b),
  );
}

// 정렬 고르기 — 세 목록이 같은 값을 쓴다(명단에서 본 순서가 시트에서도 같게)
export function RosterSortSelect({ value, onChange }: { value: RosterSort; onChange: (sort: RosterSort) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RosterSort)}
      aria-label="정렬"
      className="h-8 shrink-0 rounded-lg bg-panel2 px-2 text-caption font-medium text-dim outline-none"
    >
      {(Object.keys(ROSTER_SORT_LABEL) as RosterSort[]).map((key) => (
        <option key={key} value={key}>
          {ROSTER_SORT_LABEL[key]}
        </option>
      ))}
    </select>
  );
}
