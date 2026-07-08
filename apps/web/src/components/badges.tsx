'use client';

import { Gender, Grade, IGame } from '@letscok/shared-types';
import { motion } from 'motion/react';

// 급수 배지 색 — 고수(A)일수록 따뜻한 색 (관제판·모임원 화면 공용)
const GRADE_STYLE: Record<Grade, string> = {
  A: 'bg-coral/20 text-coral',
  B: 'bg-amber/20 text-amber',
  C: 'bg-[#ffd76e]/15 text-[#ffd76e]',
  D: 'bg-court/15 text-court',
  E: 'bg-sky/15 text-sky',
  F: 'bg-[#b7a8ff]/15 text-[#b7a8ff]',
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${GRADE_STYLE[grade]}`}
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
    <span className="inline-flex shrink-0 items-center rounded bg-court px-1.5 py-0.5 text-[10px] font-bold text-bg">
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
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
      {game.players?.map((player) => {
        const member = player.attendance?.member;
        if (!member) return null;
        const isMe = member.id === highlightMemberId;
        // 대기 조합 카드에 있는데 본인은 다른 코트에서 게임 중 = 미리 짜둔 조합의 차용 인원
        const isBusy = game.status === 'QUEUED' && player.attendance?.status === 'PLAYING';
        return (
          <div key={player.id} className="flex items-center gap-1.5 text-sm">
            <GradeBadge grade={member.grade} />
            <span className={`truncate font-medium ${isMe ? 'font-bold text-court' : ''}`}>
              {member.name}
            </span>
            <GenderMarker gender={member.gender} />
            {isMe && <MeChip />}
            {member.isGuest && <span className="text-[10px] text-sky">G</span>}
            {isBusy && (
              <span className="shrink-0 rounded bg-court/15 px-1 py-0.5 text-[10px] font-medium text-court">
                게임 중
              </span>
            )}
            {!isBusy && overlapIds?.has(player.attendanceId) && (
              <span
                title="다른 대기 조합에도 포함"
                className="shrink-0 rounded bg-amber/15 px-1 py-0.5 text-[10px] font-medium text-amber"
              >
                겹침
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <motion.div
      // 가로 중앙 정렬도 motion transform으로 — tailwind translate 클래스는 motion이 덮어써서 못 씀
      initial={{ opacity: 0, y: 16, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      className="fixed bottom-6 left-1/2 z-50 rounded-xl border border-coral/40 bg-panel px-5 py-3 text-sm text-coral shadow-lg"
    >
      {message}
    </motion.div>
  );
}
