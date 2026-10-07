'use client';

// 모임원 화면 — 관제판과 같은 보드를 읽기 전용으로 본다 (모바일 세로 스택)
// 위에 내 상태 한 문장(게임 중이면 초록 코트 카드) + 내 게임 4명, 아래 지금 코트·다음 게임·대기 인원 목록
// 디자인 시스템 규칙: 카드 구분은 테두리 대신 면(panel·panel2), 글자 크기는 text-display~text-caption 6단계

import { GAME_SIZE, IAttendance, ICourt, IGame } from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { gamePartnerPeople, GenderMarker, GradeBadge, MeChip, PartnerNote, Toast } from '@/components/badges';
import { ConnectionError } from '@/components/connection-error';
import { HomeLink } from '@/components/home-link';
import { ExitGuard } from '@/components/exit-guard';
import { InstallPrompt } from '@/components/install-prompt';
import { LogoLoader } from '@/components/logo-loader';
import { MotionCard } from '@/components/motion-card';
import { PushToggle } from '@/components/push-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { api, ApiError } from '@/lib/api';
import { getMemberId } from '@/lib/member';
import {
  formatElapsed,
  formatWaitingMinutes,
  useNow,
  useSnapshot,
} from '@/lib/use-snapshot';
import { useToast } from '@/lib/use-toast';

export default function MyStatusPage() {
  const { snapshot, noSession, failed, loading, refetch } = useSnapshot();
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
  const { toast, showToast } = useToast();
  const toggleRest = async () => {
    if (busy || !me) return;
    setBusy(true);
    try {
      const action = me.status === 'RESTING' ? 'resume' : 'rest';
      await api(`/attendances/${me.id}/${action}`, { method: 'PATCH' });
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.', 'error', 4000);
    } finally {
      setBusy(false);
    }
  };

  if (!mounted || loading) {
    return <Shell><LogoLoader className="py-20" /></Shell>;
  }
  if (failed && !snapshot) {
    return (
      <Shell>
        <ConnectionError onRetry={refetch} />
      </Shell>
    );
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
          href="/m/checkin"
          className="flex h-14 items-center justify-center rounded-xl bg-court text-body font-bold text-bg"
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
  // 빈칸 있는 조합은 운영진이 아직 짜는 중 — 4명이 다 찬 조합만 보여 주고 순번도 그것만 센다
  const queuedGames = games.filter((g) => g.status === 'QUEUED' && (g.players?.length ?? 0) >= GAME_SIZE);
  // 콕 미확인은 아직 배정 대상이 아니라 대기 인원에서 뺀다 (관제판과 같은 기준)
  // 빈칸 조합에만 든 사람(MATCHED)도 모임원 눈에는 아직 대기 — 보이는 조합에 없으면 대기 인원에 둔다
  const inVisibleGame = new Set(queuedGames.flatMap((g) => (g.players ?? []).map((p) => p.attendanceId)));
  const waiting = attendances.filter(
    (a) =>
      a.shuttleConfirmedAt &&
      (a.status === 'CHECKED_IN' || (a.status === 'MATCHED' && !inVisibleGame.has(a.id))),
  );
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

  // 내 게임 — 게임 중이면 그 코트, 조합에 들었으면 가장 앞의 조합(겹쳐 들어간 경우)
  const includesMe = (game: IGame) => (game.players ?? []).some((p) => p.attendanceId === me.id);
  const myGame =
    games.find((g) => g.status === 'PLAYING' && includesMe(g)) ?? queuedGames.find(includesMe) ?? null;

  return (
    <Shell>
      {/* 로고 = 홈 링크 */}
      <HomeLink className="flex h-11 items-center self-start text-caption font-bold tracking-[0.3em] text-court transition-opacity hover:opacity-70">
        LETSCOK
      </HomeLink>
      <MyStatus me={me} myGame={myGame} waiting={waiting} queuedGames={queuedGames} courts={courts} now={now} />

      {myGame && <MyGameCard game={myGame} playing={myGame.status === 'PLAYING'} memberId={memberId} />}

      {/* 타임 버튼 — 대기·조합 대기 중에만. 게임 중·퇴장엔 의미 없어 숨김
          (MATCHED는 눌러도 서버가 409로 막고 "운영진에게 말씀해주세요" 안내) */}
      {(me.status === 'CHECKED_IN' || me.status === 'MATCHED') && (
        <button
          onClick={() => void toggleRest()}
          disabled={busy}
          className="h-13 rounded-xl bg-panel text-body font-bold text-sky disabled:opacity-50"
        >
          잠깐 쉴래요
        </button>
      )}
      {me.status === 'RESTING' && (
        <button
          onClick={() => void toggleRest()}
          disabled={busy}
          className="h-14 rounded-xl bg-court text-body font-bold text-bg disabled:opacity-50"
        >
          다시 뛸래요
        </button>
      )}
      <PushToggle memberId={me.memberId} />

      {/* 지금 코트 — 한 덩어리 카드에 줄로(테두리 대신 면) */}
      <Section title="지금 코트" count={`${playingByCourt.size}/${courts.length}`}>
        {courts.length === 0 ? (
          <Empty>등록된 코트가 없어요</Empty>
        ) : (
          <ListCard>
            {courts.map((court) => {
              const game = playingByCourt.get(court.id);
              const otherTurn = !game && court.isShared && !court.ourTurn;
              return (
                <Row
                  key={court.id}
                  badge={court.courtNo}
                  badgeCls={game ? 'bg-court/15 text-court' : otherTurn ? 'bg-sky/15 text-sky' : 'bg-panel2 text-dim'}
                  title={game ? playerNames(game) : otherTurn ? '다른 모임 차례' : '비어 있음'}
                  titleCls={game ? '' : 'text-dim'}
                  sub={game ? (includesMe(game) ? '내 게임' : '게임 중') : otherTurn ? '공유 코트' : '곧 다음 게임이 들어가요'}
                  right={
                    game?.startedAt ? (
                      <span className="tabular font-mono text-body font-semibold text-court">
                        {formatElapsed(game.startedAt, now)}
                      </span>
                    ) : null
                  }
                />
              );
            })}
          </ListCard>
        )}
      </Section>

      <Section title="다음 게임" count={String(queuedGames.length)}>
        {queuedGames.length === 0 ? (
          <Empty>아직 짜인 게임이 없어요</Empty>
        ) : (
          <ListCard>
            {queuedGames.map((game, index) => (
              <Row
                key={game.id}
                badge={index + 1}
                badgeCls="bg-amber/20 text-amber"
                title={playerNames(game)}
                sub={
                  includesMe(game)
                    ? '내 게임'
                    : (game.players ?? []).some((p) => overlapIds.has(p.attendanceId))
                      ? '다른 조합과 겹친 사람 있음'
                      : null
                }
                subCls={includesMe(game) ? 'text-amber font-bold' : undefined}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <Section title="대기 인원" count={String(waiting.length)}>
        {waiting.length === 0 && resting.length === 0 ? (
          <Empty>대기 인원이 없어요</Empty>
        ) : (
          <ListCard>
            <AnimatePresence initial={false}>
              {waiting.map((attendance) => (
                <PersonRow
                  key={attendance.id}
                  attendance={attendance}
                  isMe={attendance.memberId === memberId}
                  right={`${attendance.gamesPlayed}게임 · ${formatWaitingMinutes(attendance.waitingSince, now)}`}
                />
              ))}
              {resting.map((attendance) => (
                <PersonRow
                  key={attendance.id}
                  attendance={attendance}
                  isMe={attendance.memberId === memberId}
                  resting
                  right={`${attendance.gamesPlayed}게임 · ${formatWaitingMinutes(attendance.waitingSince, now)}`}
                />
              ))}
            </AnimatePresence>
          </ListCard>
        )}
      </Section>
      {toast && <Toast toast={toast} />}
    </Shell>
  );
}

// 게임 4명 이름 — 목록 한 줄용
function playerNames(game: IGame): string {
  return (game.players ?? []).map((p) => p.attendance?.member?.name ?? '').filter(Boolean).join(', ');
}

// 내 상태 — 모임원이 이 앱을 여는 이유("어디로 가요? 언제예요?")를 가장 크게 한 문장으로 보여 준다(스크롤해도 위에 고정)
// 숫자는 전부 지금 스냅샷에서 정확히 나오는 것만(코트 번호·경과·순번). 예상 시간은 [게임 종료]를 늦게 누르면 틀어져 넣지 않는다
// 게임 중이면 초록 큰 카드("N번 코트로 오세요"), 그 밖에는 큰 문장
function MyStatus({
  me,
  myGame,
  waiting,
  queuedGames,
  courts,
  now,
}: {
  me: IAttendance;
  myGame: IGame | null;
  waiting: IAttendance[];
  queuedGames: IGame[]; // queueOrder 순(서버 정렬)
  courts: ICourt[];
  now: number;
}) {
  const name = me.member?.name ?? '';
  const greeting = `${name}님, 오늘 ${me.gamesPlayed}게임 했어요`;

  if (me.status === 'PLAYING') {
    const court = courts.find((c) => c.id === myGame?.courtId);
    return (
      <header className="sticky top-[var(--safe-top)] z-10 overflow-hidden rounded-2xl bg-court px-5 py-6 text-bg">
        <CourtLines />
        <p className="text-body-sm font-bold">지금 게임이에요</p>
        {court ? (
          <p className="flex items-baseline gap-1.5">
            <span className="tabular text-[4.5rem] leading-[4.75rem] font-bold tracking-tight">{court.courtNo}</span>
            <span className="text-display font-bold">번 코트로 오세요</span>
          </p>
        ) : (
          <p className="text-display font-bold">코트로 오세요</p>
        )}
        {myGame?.startedAt && (
          <p className="tabular font-mono text-body font-semibold opacity-80">
            시작한 지 {formatElapsed(myGame.startedAt, now)}
          </p>
        )}
      </header>
    );
  }

  let title: string;
  let sub: string;
  let tone = 'text-ink';
  if (me.status === 'LEFT') {
    title = '퇴장했어요';
    sub = '다시 오면 코드로 다시 체크인해 주세요';
    tone = 'text-dim';
  } else if (!me.shuttleConfirmedAt) {
    // 콕 확인 전엔 대기 목록에 없어 순번이 안 잡힌다 — 순번 대신 할 일을 보여준다
    title = '콕 확인을 기다려요';
    sub = '콕을 내고 운영진 확인을 받으면 게임에 들어갈 수 있어요';
    tone = 'text-amber';
  } else if (me.status === 'RESTING') {
    title = '쉬는 중이에요';
    // 휴식도 대기 시간에 들어간다(잠깐 쉬는 것이지 나갔다 오는 게 아님) — 복귀하면 이어서
    sub = `기다린 지 ${formatWaitingMinutes(me.waitingSince, now)} · 다시 뛰려면 아래 버튼을 눌러 주세요`;
    tone = 'text-sky';
  } else {
    // 겹쳐 들어간 조합이 여럿이면 가장 앞의 것 기준. 빈칸 조합에만 든 경우(order 0)는 아직 대기로
    const order = me.status === 'MATCHED' ? queuedGames.findIndex((g) => g.id === myGame?.id) + 1 : 0;
    if (order === 1) {
      title = '바로 다음 게임이에요';
      sub = '코트가 비면 불러 드릴게요';
      tone = 'text-amber';
    } else if (order > 1) {
      title = `다음 게임 ${order}번째예요`;
      sub = `앞에 ${order - 1}조합이 있어요`;
      tone = 'text-amber';
    } else {
      title = `대기 ${waiting.findIndex((a) => a.id === me.id) + 1}번째예요`;
      sub = `기다린 지 ${formatWaitingMinutes(me.waitingSince, now)} · 조합을 기다리는 중`;
    }
  }

  return (
    <header className="sticky top-[var(--safe-top)] z-10 -mx-5 flex flex-col gap-1.5 bg-bg/95 px-5 py-3 backdrop-blur">
      <p className="text-body-sm font-medium text-dim">{greeting}</p>
      <h1 className={`text-display font-bold transition-colors duration-300 ${tone}`}>{title}</h1>
      <p className="text-body text-dim">{sub}</p>
    </header>
  );
}

// 게임 중 카드 배경의 코트 라인 무늬(앱 아이콘과 같은 그림)
function CourtLines() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="150"
      height="190"
      fill="none"
      aria-hidden
      className="pointer-events-none absolute -top-5 -right-6 opacity-20"
    >
      <rect x="24" y="14" width="52" height="72" rx="3" stroke="currentColor" strokeWidth="3" />
      <path d="M24 36 H76 M24 64 H76 M50 14 V36 M50 64 V86" stroke="currentColor" strokeWidth="2" />
      <path d="M17 50 H83" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

// 내 게임 4명 — 게임 중이면 "같은 코트", 조합 대기면 "함께 칠 사람"
function MyGameCard({ game, playing, memberId }: { game: IGame; playing: boolean; memberId: string | null }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
      <h2 className="text-body-sm font-bold text-dim">{playing ? '같은 코트' : '함께 칠 사람'}</h2>
      <div className="grid grid-cols-2 gap-2">
        {(game.players ?? []).map((player) => {
          const member = player.attendance?.member;
          if (!member) return null;
          const isMe = member.id === memberId;
          return (
            <div key={player.id} className="flex h-13 min-w-0 items-center gap-2 rounded-xl bg-panel2 px-3">
              <GradeBadge grade={member.grade} />
              <span className={`min-w-0 truncate text-body ${isMe ? 'font-bold text-court' : 'font-medium'}`}>
                {member.name}
              </span>
              <GenderMarker gender={member.gender} />
              {isMe && <span className="ml-auto"><MeChip /></span>}
            </div>
          );
        })}
      </div>
      <PartnerNote people={gamePartnerPeople(game)} className="" />
    </section>
  );
}

function Section({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-heading font-bold">
        {title}
        <span className="tabular font-mono text-body-sm font-medium text-faint">{count}</span>
      </h2>
      {children}
    </section>
  );
}

// 줄 목록 카드 — 한 덩어리 면 위에 줄을 쌓고 사이만 옅은 선(카드마다 테두리를 두르지 않는다)
function ListCard({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col divide-y divide-panel2 overflow-hidden rounded-2xl bg-panel">{children}</div>;
}

function Row({
  badge,
  badgeCls,
  title,
  titleCls = '',
  sub,
  subCls,
  right,
}: {
  badge: number;
  badgeCls: string;
  title: string;
  titleCls?: string;
  sub?: string | null;
  subCls?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={`tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-body font-bold ${badgeCls}`}>
        {badge}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-body font-medium ${titleCls}`}>{title}</span>
        {sub && <span className={`text-caption ${subCls ?? 'text-dim'}`}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

function PersonRow({
  attendance,
  isMe,
  resting,
  right,
}: {
  attendance: IAttendance;
  isMe: boolean;
  resting?: boolean;
  right: string;
}) {
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard
      className={`flex items-center gap-2 px-4 py-3 ${isMe ? 'bg-court/10' : ''} ${resting && !isMe ? 'opacity-60' : ''}`}
    >
      <GradeBadge grade={member.grade} />
      <span className={`min-w-0 truncate text-body ${isMe ? 'font-bold text-court' : 'font-medium'}`}>{member.name}</span>
      <GenderMarker gender={member.gender} />
      {isMe && <MeChip />}
      {member.isGuest && <span className="shrink-0 text-caption text-sky">게스트</span>}
      {resting && (
        <span className="shrink-0 rounded-md bg-sky/15 px-1.5 py-0.5 text-caption font-medium text-sky">휴식</span>
      )}
      <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">{right}</span>
    </MotionCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-panel p-5 text-center text-body-sm text-faint">{children}</p>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 pt-2 pb-6">
      {/* 설치 배너는 /m의 모든 상태(로딩·모임 전·미체크인·참여 중)에서 같은 자리에 뜬다 */}
      <InstallPrompt />
      {children}
      {/* 화면 테마 — 모든 상태(모임 전·미체크인·참여 중)에서 맨 아래 같은 자리 */}
      <ThemeToggle className="mt-auto" />
      {/* 설치 앱에서 첫 화면 뒤로가기 = "한 번 더 누르면 종료" */}
      <ExitGuard />
    </main>
  );
}

function Centered({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <HomeLink className="text-caption font-bold tracking-[0.3em] text-court transition-opacity hover:opacity-70">
        LETSCOK
      </HomeLink>
      <h1 className="text-display font-bold">{title}</h1>
      <p className="text-body text-dim">{desc}</p>
    </div>
  );
}
