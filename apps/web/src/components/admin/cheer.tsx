'use client';

import { IMemberSummary, MemberRole } from '@letscok/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

// 이스터에그 — 대기 인원 머리의 숨은 칸을 13번 누르면 모임장 응원

const CHEER_DURATION_MS = 10_000; // 이 동안은 탭을 삼켜 유지 — 연타 여운으로 바로 닫히던 문제 해결

export function CheerEasterEgg({ onDone }: { onDone: () => void }) {
  // 낙하 반짝이 — 마운트 시 한 번만 랜덤 생성(무한 반복이라 10초 내내 쏟아진다)
  const sparkles = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2.6,
        size: 14 + Math.random() * 20,
        emoji: ['✨', '🌟', '💫', '🏸', '⭐', '🎉'][i % 6],
      })),
    [],
  );
  // 글자 주변 제자리 반짝임 — 촌스러운 후광 연출용
  const twinkles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        top: -20 + Math.random() * 140,
        left: -10 + Math.random() * 120,
        delay: Math.random() * 1.1,
        size: 12 + Math.random() * 16,
        emoji: ['✨', '⭐', '💖', '🌟'][i % 4],
      })),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(onDone, CHEER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);
  // 응원 대상 = 모임원 관리에서 역할이 모임장인 사람 (여럿이면 전원, 없거나 조회 실패면 "모임장")
  // null = 조회 중 — 문구를 바꿔치기하며 깜빡이지 않도록 이름이 정해진 뒤에 띄운다
  const [leaderName, setLeaderName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<IMemberSummary[]>('/members', { admin: true })
      .then((members) => {
        const names = members
          .filter((m) => m.role === MemberRole.LEADER && !m.deletedAt)
          .map((m) => m.name);
        if (!cancelled) setLeaderName(names.length > 0 ? names.join('·') : '모임장');
      })
      .catch(() => {
        if (!cancelled) setLeaderName('모임장');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    // 클릭/터치를 전부 삼킨다 — 10초 동안 화면이 눌리지 않게 (닫기는 타이머만)
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 flex touch-none select-none items-center justify-center overflow-hidden bg-black/50"
    >
      {sparkles.map((s) => (
        <span
          key={s.id}
          className="sparkle-fall absolute top-0"
          style={{ left: `${s.left}%`, animationDelay: `${s.delay}s`, fontSize: s.size }}
        >
          {s.emoji}
        </span>
      ))}
      <div className="relative">
        {/* 회전하는 무지개 후광 — 글자 뒤 */}
        <div className="cheer-glow absolute -inset-x-20 -inset-y-14 rounded-full" />
        {twinkles.map((t) => (
          <span
            key={t.id}
            className="cheer-twinkle absolute"
            style={{
              top: `${t.top}%`,
              left: `${t.left}%`,
              animationDelay: `${t.delay}s`,
              fontSize: t.size,
            }}
          >
            {t.emoji}
          </span>
        ))}
        {/* 폰에서는 두 줄, 태블릿 이상은 한 줄 — 긴 문구가 좁은 화면에서 깨지지 않게 */}
        {/* 폰은 vw로 상한을 둬 좁은 기기(320px)에서도 안 잘리게, 태블릿 이상은 고정 크기 */}
        {leaderName !== null && (
          <p className="cheer-pop relative text-center text-[clamp(3rem,15vw,4.5rem)] leading-tight font-bold sm:text-[6rem]">
            <span className="block sm:inline">{leaderName}</span>{' '}
            <span className="block sm:inline">화이팅!!</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ===== 수동 체크인 모달 =====

// 모임 전 사전 등록·이미 게임 중인 인원 등을 운영진이 대신 체크인
// 미등록 인원은 구두 동의 전제로 대리 등록+체크인까지 — 게스트는 이름·급수·성별만(생년월일 미수집 정책),
// 모임원은 생년월일 포함(운영진이 알 수 있음). 본인 폰 연결은 걱정 없음:
// 나중에 본인이 코드로 들어오면 409를 /checkin이 "본인 확인 완료"로 받아 /m 진입
