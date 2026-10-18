'use client';

import { IAttendance } from '@letscok/shared-types';
import { GRADES } from '@/components/multi-member-form';

// 사람 목록 정렬(대기 명단·빈칸 채우기·선수 교체 공용) — 모임장·운영진 고정, 그 아래는 고른 기준 하나로만
// (상태로 묶지 않는다 — 이름순이면 그냥 가나다순. 같으면 오래 기다린 순)

// 모임장 → 운영진을 맨 위에 고정(현장에서 찾기 쉽게)
const ROLE_RANK: Record<string, number> = { LEADER: 0, MANAGER: 1 };

export const roleRank = (a: IAttendance) => ROLE_RANK[a.member?.role ?? 'MEMBER'] ?? 2;

// 명단에 보이는 상태 — 퇴장은 빠진다
const ROSTER_STATUSES: IAttendance['status'][] = ['CHECKED_IN', 'MATCHED', 'PLAYING', 'RESTING'];

export function sortRoster(attendances: IAttendance[], sort: RosterSort): IAttendance[] {
  return sortCandidates(
    attendances.filter((a) => a.shuttleConfirmedAt && ROSTER_STATUSES.includes(a.status)),
    sort,
  );
}

// 정렬 기준 — 오래 기다린 순·가나다순·A→F 급수순·게임 적은 순
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

// 실제로 뛴 게임 수 — gamesPlayed는 종료 때 오르므로 지금 뛰는 게임도 한 게임으로 센다
const gamesSoFar = (a: IAttendance) => a.gamesPlayed + (a.status === 'PLAYING' ? 1 : 0);

export function sortCandidates(attendances: IAttendance[], sort: RosterSort): IAttendance[] {
  const byKey = (a: IAttendance, b: IAttendance) => {
    if (sort === 'NAME') return (a.member?.name ?? '').localeCompare(b.member?.name ?? '', 'ko');
    if (sort === 'GRADE') return GRADES.indexOf(a.member?.grade ?? 'F') - GRADES.indexOf(b.member?.grade ?? 'F');
    if (sort === 'GAMES') return gamesSoFar(a) - gamesSoFar(b);
    return 0;
  };
  return [...attendances].sort((a, b) => roleRank(a) - roleRank(b) || byKey(a, b) || waitedLonger(a, b));
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
