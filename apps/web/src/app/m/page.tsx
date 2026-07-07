'use client';

// 모임원 화면 — 관제판과 같은 보드를 읽기 전용으로 본다 (모바일 세로 스택)
// 상단에 내 상태 한 줄 + 아래 3구역(게임 중/대기 조합/대기 인원), 내 이름은 초록 강조

import { IAttendance } from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { GradeBadge, MeChip, PlayerGrid } from '@/components/badges';
import { MotionCard } from '@/components/motion-card';
import { getMemberId } from '@/lib/member';
import {
  formatElapsed,
  formatWaitingMinutes,
  useNow,
  useSnapshot,
} from '@/lib/use-snapshot';

export default function MyStatusPage() {
  const { snapshot, noSession, loading } = useSnapshot();
  const now = useNow();

  // localStorage는 클라이언트 전용 — hydration 불일치 방지를 위해 마운트 후 판독
  const [memberId, setMemberId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMemberId(getMemberId());
    setMounted(true);
  }, []);

  const me = useMemo(
    () => snapshot?.attendances.find((a) => a.memberId === memberId) ?? null,
    [snapshot, memberId],
  );

  if (!mounted || loading) {
    return <Shell><p className="py-20 text-center text-dim">불러오는 중...</p></Shell>;
  }
  if (noSession || !snapshot) {
    return (
      <Shell>
        <Centered title="아직 모임 전이에요" desc="모임이 시작되면 이 화면에서 코트 현황을 볼 수 있어요" />
      </Shell>
    );
  }
  if (!me) {
    return (
      <Shell>
        <Centered title="체크인이 필요해요" desc="셔틀콕 내고 QR 찍으셨나요?" />
        <Link
          href="/checkin"
          className="flex h-14 items-center justify-center rounded-xl bg-court text-lg font-bold text-bg"
        >
          체크인하러 가기
        </Link>
      </Shell>
    );
  }

  const { courts, attendances, games } = snapshot;
  const playingByCourt = new Map(
    games.filter((g) => g.status === 'PLAYING' && g.courtId).map((g) => [g.courtId as string, g]),
  );
  const queuedGames = games.filter((g) => g.status === 'QUEUED');
  const waiting = attendances.filter((a) => a.status === 'CHECKED_IN');
  // 여러 대기 조합에 겹쳐 들어간 인원 표시 (관제판과 동일 기준)
  const overlapCounts = new Map<string, number>();
  for (const game of queuedGames) {
    for (const player of game.players ?? []) {
      overlapCounts.set(player.attendanceId, (overlapCounts.get(player.attendanceId) ?? 0) + 1);
    }
  }
  const overlapIds = new Set(
    [...overlapCounts].filter(([, count]) => count >= 2).map(([id]) => id),
  );

  return (
    <Shell>
      <MyBanner me={me} waiting={waiting} now={now} />

      {/* 게임 중 — 관제판과 동일 정보, 버튼만 없음 */}
      <SectionTitle accent="text-court" title="게임 중" count={playingByCourt.size} />
      {courts.length === 0 && <Empty>등록된 코트가 없어요</Empty>}
      <AnimatePresence initial={false}>
        {courts.map((court) => {
          const game = playingByCourt.get(court.id);
          return game ? (
            <MotionCard key={court.id} className="rounded-xl border border-court/40 bg-panel2 p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-court">{court.courtNo}번 코트</span>
                <span className="tabular font-mono text-xl font-semibold text-court">
                  {game.startedAt ? formatElapsed(game.startedAt, now) : '--:--'}
                </span>
              </div>
              <PlayerGrid game={game} highlightMemberId={memberId} />
            </MotionCard>
          ) : (
            <MotionCard key={court.id} className="rounded-xl border border-dashed border-line p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-dim">{court.courtNo}번 코트</span>
                <span className="text-xs text-faint">비어 있음</span>
              </div>
            </MotionCard>
          );
        })}
      </AnimatePresence>

      <SectionTitle accent="text-amber" title="대기 조합" count={queuedGames.length} />
      {queuedGames.length === 0 && <Empty>아직 짜인 게임이 없어요</Empty>}
      <AnimatePresence initial={false}>
        {queuedGames.map((game, index) => (
          <MotionCard key={game.id} className="rounded-xl border border-amber/30 bg-panel2 p-4">
            <span className="font-bold text-amber">다음 게임 {index + 1}</span>
            <PlayerGrid game={game} highlightMemberId={memberId} overlapIds={overlapIds} />
          </MotionCard>
        ))}
      </AnimatePresence>

      <SectionTitle accent="text-ink" title="대기 인원" count={waiting.length} />
      {waiting.length === 0 && <Empty>대기 인원이 없어요</Empty>}
      <AnimatePresence initial={false}>
        {waiting.map((attendance) => {
          const member = attendance.member;
          if (!member) return null;
          const isMe = member.id === memberId;
          return (
            <MotionCard
              key={attendance.id}
              className={`flex items-center gap-2 rounded-xl border p-3 ${
                isMe ? 'border-court bg-court/10' : 'border-line bg-panel2'
              }`}
            >
              <GradeBadge grade={member.grade} />
              <span className={`font-medium ${isMe ? 'font-bold text-court' : ''}`}>
                {member.name}
              </span>
              {isMe && <MeChip />}
              {member.isGuest && <span className="text-[10px] text-sky">게스트</span>}
              <span className="tabular ml-auto font-mono text-xs text-dim">
                {attendance.gamesPlayed}게임 · {formatWaitingMinutes(attendance.waitingSince, now)}
              </span>
            </MotionCard>
          );
        })}
      </AnimatePresence>
    </Shell>
  );
}

// 내 상태 한 줄 배너 — 지금 뭘 해야 하는지만 크게 (스크롤해도 상단 고정)
function MyBanner({
  me,
  waiting,
  now,
}: {
  me: IAttendance;
  waiting: IAttendance[];
  now: number;
}) {
  const member = me.member;

  let statusText: string;
  let statusClass = 'border-line bg-panel';
  if (me.status === 'CHECKED_IN') {
    const position = waiting.findIndex((a) => a.id === me.id) + 1;
    statusText = `대기 ${position}번째 · ${formatWaitingMinutes(me.waitingSince, now)}`;
  } else if (me.status === 'MATCHED') {
    statusClass = 'border-amber bg-amber/10 text-amber';
    statusText = '게임 예정 — 곧 불러요!';
  } else if (me.status === 'PLAYING') {
    statusClass = 'border-court bg-court/10 text-court';
    statusText = '게임 중';
  } else {
    statusText = '퇴장 — 다시 오면 QR 재체크인';
  }

  return (
    <header
      className={`sticky top-0 z-10 flex items-center gap-2 rounded-xl border p-3 backdrop-blur transition-colors duration-300 ${statusClass}`}
    >
      {member && <GradeBadge grade={member.grade} />}
      <span className="font-bold">{member?.name}</span>
      <span className="text-sm">{statusText}</span>
      <span className="tabular ml-auto font-mono text-sm opacity-80">
        {me.gamesPlayed}게임
      </span>
    </header>
  );
}

function SectionTitle({
  accent,
  title,
  count,
}: {
  accent: string;
  title: string;
  count: number;
}) {
  return (
    <h2 className={`mt-2 flex items-baseline gap-2 text-sm font-bold ${accent}`}>
      {title}
      <span className="tabular font-mono text-xs text-faint">{count}</span>
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-faint">{children}</p>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col gap-2 p-4">
      {children}
    </main>
  );
}

function Centered({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-xs font-medium tracking-[0.3em] text-court">LETSCOK</p>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-dim">{desc}</p>
    </div>
  );
}
