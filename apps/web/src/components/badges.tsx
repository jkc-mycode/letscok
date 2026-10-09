'use client';

import { Gender, Grade, IGame } from '@letscok/shared-types';
import { motion } from 'motion/react';
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
            <GradeBadge grade={member.grade} />
            {/* 이름은 줄이지 않는다 — 좁으면 옆 칩이 줄어든다 */}
            <span className={`shrink-0 whitespace-nowrap font-medium ${isMe ? 'font-bold text-court' : ''}`}>
              {member.name}
            </span>
            <GenderMarker gender={member.gender} />
            {isMe && <MeChip />}
            {member.isGuest && <span className="shrink-0 text-caption text-sky">G</span>}
            {isBusy && (
              <span className="min-w-0 truncate rounded bg-court/15 px-1 py-0.5 text-caption font-medium text-court">
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
    </motion.div>
  );
}
