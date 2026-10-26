'use client';

import { Gender, Grade, IAttendance, IGame, MemberRole } from '@letscok/shared-types';
import { motion } from 'motion/react';
import { createContext, useContext } from 'react';
import { CrownIcon } from '@/components/icons';
import type { ToastState } from '@/lib/use-toast';

// 급수 배지 색 — 고수(A)일수록 따뜻한 색 (관제판·모임원 화면 공용)
const GRADE_STYLE: Record<Grade, string> = {
  A: 'bg-coral/20 text-coral',
  B: 'bg-amber/20 text-amber',
  C: 'bg-gold/15 text-gold',
  D: 'bg-court/15 text-court',
  E: 'bg-sky/15 text-sky',
  F: 'bg-violet/15 text-violet',
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-caption font-bold ${GRADE_STYLE[grade]}`}
    >
      {grade}
    </span>
  );
}

// 성별 마커 — 남성 ♂(파랑)·여성 ♀(분홍). 미지정(null)은 표시하지 않음
// (복식 종목 판단용 — 이름 옆 어디서든 공용)
export function GenderMarker({ gender }: { gender: Gender | null }) {
  if (!gender) return null;
  return (
    <span
      className={`shrink-0 text-xs ${gender === 'MALE' ? 'text-sky' : 'text-pink'}`}
      title={gender === 'MALE' ? '남성' : '여성'}
    >
      {gender === 'MALE' ? '♂' : '♀'}
    </span>
  );
}

// 모임장(주황)·운영진(초록) 왕관 — 글자 칩보다 자리를 덜 차지한다
export function RoleCrown({ role }: { role: MemberRole }) {
  if (role === 'MEMBER') return null;
  const label = role === 'LEADER' ? '모임장' : '운영진';
  return (
    <span title={label} className={`flex shrink-0 ${role === 'LEADER' ? 'text-amber' : 'text-court'}`}>
      <CrownIcon size={14} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// 게스트 표시 — short "G"(좁은 줄), full "게스트"(넓은 목록), auto 폰에선 "G"·넓은 화면에선 "게스트"(이름 자리를 지키려고)
export type GuestMarkSize = 'short' | 'full' | 'auto';
export function GuestMark({ size = 'auto' }: { size?: GuestMarkSize }) {
  return (
    <span className="shrink-0 text-caption text-sky">
      {size === 'short' && 'G'}
      {size === 'full' && '게스트'}
      {size === 'auto' && (
        <>
          <span className="sm:hidden">G</span>
          <span className="hidden sm:inline">게스트</span>
        </>
      )}
    </span>
  );
}

// 동명이인 꼬리표(회원 id → "97"·"①") — 같은 모임에 이름이 똑같은 사람이 있을 때만 생긴다
// 보드를 그리는 화면(관제판·전광판·모임원 앱)이 그날 출석으로 채워 넣고, 그 밖의 화면은 빈 표라 꼬리표가 없다
const SameNameTagsContext = createContext<ReadonlyMap<string, string>>(new Map());
export const SameNameTagsProvider = SameNameTagsContext.Provider;

const ORDINALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

// 같은 이름끼리 출생 연도가 겹치지 않으면 연도 두 자리, 겹치거나 없으면 체크인 순 번호
export function buildSameNameTags(attendances: IAttendance[]): Map<string, string> {
  const groups = new Map<string, IAttendance[]>();
  for (const attendance of attendances) {
    if (!attendance.member) continue;
    const group = groups.get(attendance.member.name) ?? [];
    group.push(attendance);
    groups.set(attendance.member.name, group);
  }
  const tags = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const years = group.map((a) => a.member!.birthYear);
    const rest = group
      .filter((a) => {
        const year = a.member!.birthYear;
        if (year === null || years.filter((y) => y === year).length > 1) return true;
        tags.set(a.memberId, String(year).slice(2));
        return false;
      })
      .sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt));
    rest.forEach((a, i) => tags.set(a.memberId, ORDINALS[i] ?? `${i + 1}`));
  }
  return tags;
}

// 사람 이름 한 묶음 — 급수 · (왕관) · 이름 · (동명이인 꼬리표) · 성별 · (게스트). 순서를 여기 한 곳에서 정한다
// 감싸는 상자 없이 펼쳐서 부모 줄의 간격·줄임을 그대로 따른다. 그 뒤 칩(나·휴식·게임 중 등)은 부르는 쪽이 붙인다
// nameClassName: 이름 줄임 방식이 자리마다 다르다(줄이지 않음·truncate·최소 4글자) — 굵기·색과 함께 넘긴다
export function PersonName({
  person,
  nameClassName = 'font-medium',
  crown = false,
  guest,
}: {
  person: { id?: string; name: string; grade: Grade; gender: Gender | null; isGuest?: boolean; role?: MemberRole };
  nameClassName?: string;
  crown?: boolean; // 관제판 명단처럼 모임장·운영진을 알아야 하는 자리
  guest?: GuestMarkSize; // 생략하면 게스트 표시 없음
}) {
  const tag = useContext(SameNameTagsContext).get(person.id ?? '');
  return (
    <>
      <GradeBadge grade={person.grade} />
      {crown && person.role && <RoleCrown role={person.role} />}
      <span className={nameClassName}>{person.name}</span>
      {tag && <span className="tabular -ml-0.5 shrink-0 text-caption font-medium text-dim">{tag}</span>}
      <GenderMarker gender={person.gender} />
      {guest && person.isGuest && <GuestMark size={guest} />}
    </>
  );
}

// 본인 표시 칩 — 모임원 화면에서 어느 구역에 있든 내 이름을 한눈에 찾도록
export function MeChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-court px-1.5 py-0.5 text-caption font-bold text-bg">
      나
    </span>
  );
}

// 게임 참여 4인 그리드 — 관제판·모임원 화면 공용 (highlightMemberId = 본인 강조)
// overlapIds = 여러 대기 조합에 겹쳐 들어간 인원 (중복 대기 허용 정책 표시용)
export function PlayerGrid({
  game,
  highlightMemberId,
  overlapIds,
}: {
  game: IGame;
  highlightMemberId?: string | null;
  overlapIds?: Set<string>;
}) {
  return (
    <>
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
      {game.players?.map((player) => {
        const member = player.attendance?.member;
        if (!member) return null;
        const isMe = member.id === highlightMemberId;
        // 대기 조합 카드에 있는데 본인은 다른 코트에서 게임 중 = 미리 짜둔 조합의 차용 인원
        const isBusy = game.status === 'QUEUED' && player.attendance?.status === 'PLAYING';
        return (
          <div key={player.id} className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
            {/* 이름은 줄이지 않는다 — 좁으면 옆 칩이 줄어든다 */}
            <PersonName
              person={member}
              nameClassName={`shrink-0 whitespace-nowrap font-medium ${isMe ? 'font-bold text-court' : ''}`}
              guest="short"
            />
            {isMe && <MeChip />}
            {isBusy && (
              <span className="min-w-0 truncate rounded bg-coral/15 px-1 py-0.5 text-caption font-medium text-coral">
                게임 중
              </span>
            )}
            {!isBusy && overlapIds?.has(player.attendanceId) && (
              <span
                title="다른 대기 조합에도 포함"
                className="min-w-0 truncate rounded bg-amber/15 px-1 py-0.5 text-caption font-medium text-amber"
              >
                겹침
              </span>
            )}
          </div>
        );
      })}
    </div>
    <PartnerNote people={gamePartnerPeople(game)} />
    </>
  );
}

// 대회 연습 파트너 — 같은 게임에 든 두 사람이 서로를 가리키면 "한 팀" 한 줄(편은 코트에서 선수들이 정한다)
export type PartnerPerson = { id: string; name: string; partnerId: string | null };
export function PartnerNote({ people, className = 'mt-2' }: { people: PartnerPerson[]; className?: string }) {
  const pairs: string[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (people[i].partnerId === people[j].id && people[j].partnerId === people[i].id) {
        pairs.push(`${people[i].name}·${people[j].name}`);
      }
    }
  }
  if (pairs.length === 0) return null;
  return <p className={`${className} text-caption font-medium text-sky`}>대회 연습: {pairs.join(', ')} 한 팀</p>;
}

// 게임 카드의 4명 → 파트너 표시용
export function gamePartnerPeople(game: IGame): PartnerPerson[] {
  return (game.players ?? []).map((p) => ({
    id: p.attendanceId,
    name: p.attendance?.member?.name ?? '',
    partnerId: p.attendance?.partnerAttendanceId ?? null,
  }));
}

// 화면 아래 알약 모양 알림 — 상태는 lib/use-toast의 useToast로 관리한다
export function Toast({ toast }: { toast: ToastState }) {
  const tone =
    toast.tone === 'success' ? 'border-court/50 text-court' : 'border-coral/50 text-coral';
  return (
    <motion.div
      key={toast.message} // 새 알림이면 다시 떠오르는 애니메이션
      role="status"
      // 가로 중앙 정렬도 motion transform으로 — tailwind translate 클래스는 motion이 덮어써서 못 씀
      initial={{ opacity: 0, y: 16, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      className={`fixed bottom-[calc(var(--safe-bottom)+1.5rem)] left-1/2 z-50 max-w-[calc(100vw-2rem)] rounded-full border bg-panel px-5 py-3 text-center text-sm font-medium shadow-lg ${tone}`}
    >
      {toast.tone === 'success' ? '✓ ' : ''}
      {toast.message}
      {toast.action && (
        <button onClick={toast.action.onClick} className="tap ml-3 font-bold underline underline-offset-2">
          {toast.action.label}
        </button>
      )}
    </motion.div>
  );
}
