'use client';

import { Grade, IGame } from '@letscok/shared-types';
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

// 게임 참여 4인 그리드 — 관제판·모임원 화면 공용 (highlightMemberId = 본인 강조)
export function PlayerGrid({
  game,
  highlightMemberId,
}: {
  game: IGame;
  highlightMemberId?: string | null;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
      {game.players?.map((player) => {
        const member = player.attendance?.member;
        if (!member) return null;
        return (
          <div key={player.id} className="flex items-center gap-1.5 text-sm">
            <GradeBadge grade={member.grade} />
            <span
              className={`truncate font-medium ${
                member.id === highlightMemberId ? 'font-bold text-court' : ''
              }`}
            >
              {member.name}
            </span>
            {member.isGuest && <span className="text-[10px] text-sky">G</span>}
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
