'use client';

// 보드 카드 공용 모션 — 등장(떠오름)/퇴장(페이드)/재정렬(layout) 애니메이션
// 스냅샷 교체로 목록이 통째로 바뀌는 구조라, layout 애니메이션이 순서 변화를 자연스럽게 이어준다
// 사용처: <AnimatePresence initial={false} mode="popLayout"> 아래에서 key와 함께

import { HTMLMotionProps, motion } from 'motion/react';

export function MotionCard(props: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      {...props}
    />
  );
}
