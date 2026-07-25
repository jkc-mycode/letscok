'use client';

// 모임원 화면 — 관제판과 같은 보드를 읽기 전용으로 본다 (모바일 세로 스택)
// 상단에 내 상태 한 줄 + 아래 3구역(게임 중/대기 조합/대기 인원), 내 이름은 초록 강조

import { IAttendance } from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { GenderMarker, GradeBadge, MeChip, PlayerGrid, Toast } from '@/components/badges';
import { MotionCard } from '@/components/motion-card';
import { api, ApiError } from '@/lib/api';
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

  // 타임(잠깐 쉴래요) — 유일한 셀프 액션. 조합에 묶여 있으면 서버 409 안내를 토스트로
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toggleRest = async () => {
    if (busy || !me) return;
    setBusy(true);
    try {
      const action = me.status === 'RESTING' ? 'resume' : 'rest';
      await api(`/attendances/${me.id}/${action}`, { method: 'PATCH' });
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusy(false);
    }
  };

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
        <Centered title="체크인이 필요해요" desc="셔틀콕 내고 코드 입력하셨나요?" />
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
  // 콕 미확인은 아직 배정 대상이 아니라 대기 인원에서 뺀다 (관제판과 같은 기준)
  const waiting = attendances.filter((a) => a.status === 'CHECKED_IN' && a.shuttleConfirmedAt);
  const resting = attendances.filter((a) => a.status === 'RESTING'); // 대기 인원 뒤에 흐리게 표시
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
      {/* 로고 = 홈 링크 (스크롤하면 아래 sticky 배너가 상단을 대체) */}
      <Link
        href="/"
        className="self-center text-[11px] font-medium tracking-[0.3em] text-court/70 transition-opacity hover:opacity-70"
      >
        LETSCOK
      </Link>
      <MyBanner me={me} waiting={waiting} now={now} />

      {/* 콕 미확인 안내 — 이게 없으면 "왜 나만 게임에 안 넣어주지" 오해로 운영진 문의가 늘어난다 */}
      {!me.shuttleConfirmedAt && me.status !== 'LEFT' && (
        <p className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
          콕 제출 확인을 기다리고 있어요 — 확인되면 게임에 들어갈 수 있어요
        </p>
      )}

      {/* 타임 버튼 — 대기·조합 대기 중에만. 게임 중·퇴장엔 의미 없어 숨김
          (MATCHED는 눌러도 서버가 409로 막고 "운영진에게 말씀해주세요" 안내) */}
      {(me.status === 'CHECKED_IN' || me.status === 'MATCHED') && (
        <button
          onClick={() => void toggleRest()}
          disabled={busy}
          className="h-12 rounded-xl border border-sky/40 text-sm font-medium text-sky disabled:opacity-50"
        >
          잠깐 쉴래요 — 게임 조합에서 빼주세요
        </button>
      )}
      {me.status === 'RESTING' && (
        <button
          onClick={() => void toggleRest()}
          disabled={busy}
          className="h-12 rounded-xl bg-court text-sm font-bold text-bg disabled:opacity-50"
        >
          다시 뛸래요 — 대기로 복귀
        </button>
      )}

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
              <GenderMarker gender={member.gender} />
              {isMe && <MeChip />}
              {member.isGuest && <span className="text-[10px] text-sky">게스트</span>}
              <span className="tabular ml-auto font-mono text-xs text-dim">
                {attendance.gamesPlayed}게임 · {formatWaitingMinutes(attendance.waitingSince, now)}
              </span>
            </MotionCard>
          );
        })}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {resting.map((attendance) => {
          const member = attendance.member;
          if (!member) return null;
          const isMe = member.id === memberId;
          return (
            <MotionCard
              key={attendance.id}
              className={`flex items-center gap-2 rounded-xl border p-3 ${
                isMe ? 'border-sky bg-sky/10' : 'border-line bg-panel2 opacity-60'
              }`}
            >
              <GradeBadge grade={member.grade} />
              <span className={`font-medium ${isMe ? 'font-bold text-sky' : ''}`}>
                {member.name}
              </span>
              <GenderMarker gender={member.gender} />
              {isMe && <MeChip />}
              <span className="shrink-0 rounded bg-sky/15 px-1.5 py-0.5 text-[10px] font-medium text-sky">
                휴식
              </span>
              <span className="tabular ml-auto font-mono text-xs text-dim">
                {attendance.gamesPlayed}게임
              </span>
            </MotionCard>
          );
        })}
      </AnimatePresence>
      {toast && <Toast message={toast} />}
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
  if (me.status === 'CHECKED_IN' && !me.shuttleConfirmedAt) {
    // 콕 확인 전엔 대기 목록에 없어 순번이 안 잡힌다 — 순번 대신 대기 사유를 보여준다
    statusClass = 'border-amber bg-amber/10 text-amber';
    statusText = '콕 확인 대기 중';
  } else if (me.status === 'CHECKED_IN') {
    const position = waiting.findIndex((a) => a.id === me.id) + 1;
    statusText = `대기 ${position}번째 · ${formatWaitingMinutes(me.waitingSince, now)}`;
  } else if (me.status === 'MATCHED') {
    statusClass = 'border-amber bg-amber/10 text-amber';
    statusText = '게임 예정 — 곧 불러요!';
  } else if (me.status === 'PLAYING') {
    statusClass = 'border-court bg-court/10 text-court';
    statusText = '게임 중';
  } else if (me.status === 'RESTING') {
    statusClass = 'border-sky bg-sky/10 text-sky';
    statusText = `휴식 중 · ${formatWaitingMinutes(me.waitingSince, now)}`;
  } else {
    statusText = '퇴장 — 다시 오면 코드로 재체크인';
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
      <Link
        href="/"
        className="text-xs font-medium tracking-[0.3em] text-court transition-opacity hover:opacity-70"
      >
        LETSCOK
      </Link>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-dim">{desc}</p>
    </div>
  );
}
