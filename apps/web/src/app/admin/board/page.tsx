'use client';

// 전광판 — 대회·모임 때 태블릿·TV에 띄워 모임원에게 보여 주는 보기 전용 화면(뒤로 버튼 하나뿐, 로그인 없음)
// 관제판 앱 영역(/admin) 안에 둬서, 설치된 관제판 앱에서 열어도 주소창 없는 앱 화면으로 뜬다
// 모임원 화면과 같은 공개 현황(실시간)을 크게: 왼쪽 코트별 게임 중(팀으로 나눠), 오른쪽 다음 게임 순서

import { GAME_SIZE, IGame, IGamePlayer } from '@letscok/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { ConnectionError } from '@/components/connection-error';
import { useStandalone } from '@/components/home-link';
import { LogoLoader } from '@/components/logo-loader';
import { formatElapsed, useNow, useSnapshot } from '@/lib/use-snapshot';

// 띄워 두는 화면이라 꺼지지 않게 — 지원 안 하는 브라우저·거절은 그냥 넘어간다. 탭을 다시 보면 다시 요청(가려지면 풀린다)
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const wakeLock = (navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        }).wakeLock;
        lock = (await wakeLock?.request('screen')) ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void request();
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

export default function BoardDisplayPage() {
  const { snapshot, noSession, failed, loading, refetch } = useSnapshot();
  const now = useNow();
  useWakeLock();
  const standalone = useStandalone();
  const router = useRouter();
  // 뒤로 — 관제판에서 열었으면 그 화면으로. 주소로 바로 연 경우(기록 없음)엔 설치된 앱은 관제판, 브라우저는 홈으로
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(standalone ? '/admin' : '/');
  };

  if (loading) {
    return (
      <Shell>
        <LogoLoader className="py-20" />
      </Shell>
    );
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
        <p className="flex flex-1 items-center justify-center text-display font-bold text-dim">아직 모임 전이에요</p>
      </Shell>
    );
  }

  const { courts, attendances, games } = snapshot;
  const playingByCourt = new Map(
    games.filter((g) => g.status === 'PLAYING' && g.courtId).map((g) => [g.courtId as string, g]),
  );
  const queuedGames = games.filter((g) => g.status === 'QUEUED'); // 서버가 대기 순서로 준다
  const waitingCount = attendances.filter((a) => a.shuttleConfirmedAt && a.status === 'CHECKED_IN').length;

  return (
    <Shell>
      <header className="flex items-center gap-4">
        {/* 앱·태블릿엔 브라우저 뒤로 버튼이 없어(아이패드 설치본) 화면에 둔다 — 멀리서도 보이게 글자와 테두리를 붙인다 */}
        <button
          onClick={goBack}
          className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-panel2 pr-5 pl-4 text-body font-bold text-ink transition-opacity hover:opacity-70"
        >
          <span className="text-heading leading-none">‹</span>
          뒤로
        </button>
        <span className="ml-auto rounded-full bg-panel px-4 py-1.5 text-body font-bold text-dim">
          대기 <span className="tabular text-ink">{waitingCount}</span>명
        </span>
      </header>

      {/* 세로 화면은 위아래 두 줄을 같은 높이로(내용 길이와 상관없이 5:5), 가로 화면은 좌우 5:5 한 줄 */}
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-6 lg:grid-cols-2 lg:grid-rows-1">
        {/* 구역마다 옅은 색 틀 — 멀리서도 게임 중(초록)과 다음 게임(주황)이 갈리게 */}
        <section className="flex min-w-0 flex-col gap-3 rounded-3xl border border-court/25 bg-court/5 p-3 sm:p-4">
          <h2 className="text-heading font-bold text-court">게임 중</h2>
          {courts.length === 0 ? (
            <Empty>등록된 코트가 없어요</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {courts.map((court) => {
                const game = playingByCourt.get(court.id);
                const otherTurn = !game && court.isShared && !court.ourTurn;
                return (
                  <BoardCard
                    key={court.id}
                    dim={!game}
                    no={court.courtNo}
                    noCls={game ? 'text-court' : 'text-faint'}
                    unit="번 코트"
                    side={
                      game?.startedAt && (
                        <span className="tabular font-mono text-heading font-semibold text-court">
                          {formatElapsed(game.startedAt, now)}
                        </span>
                      )
                    }
                  >
                    {game ? (
                      <Teams game={game} />
                    ) : (
                      <p className="py-3 text-body text-faint">{otherTurn ? '다른 모임 차례' : '비어 있음'}</p>
                    )}
                  </BoardCard>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3 rounded-3xl border border-amber/25 bg-amber/5 p-3 sm:p-4">
          <h2 className="text-heading font-bold text-amber">
            다음 게임 <span className="tabular text-body text-faint">{queuedGames.length}</span>
          </h2>
          {queuedGames.length === 0 ? (
            <Empty>아직 짜인 게임이 없어요</Empty>
          ) : (
            // 코트 카드와 같은 틀·그리드 — 양쪽 카드 크기가 맞게
            <div className="grid gap-3 sm:grid-cols-2">
              {queuedGames.map((game, index) => {
                const draft = (game.players?.length ?? 0) < GAME_SIZE;
                return (
                  <BoardCard
                    key={game.id}
                    dim={draft}
                    no={index + 1}
                    noCls="text-amber"
                    unit="번째"
                    side={draft && <span className="text-body font-medium text-faint">짜는 중</span>}
                  >
                    <Teams game={game} />
                  </BoardCard>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

// 게임 중·다음 게임 공용 카드 — 큰 번호 + 단위, 오른쪽 끝 보조 글자(경과 시간·짜는 중), 아래 내용. dim: 빈 코트·짜는 중
function BoardCard({
  dim,
  no,
  noCls,
  unit,
  side,
  children,
}: {
  dim: boolean;
  no: number;
  noCls: string;
  unit: string;
  side?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-4 ${dim ? 'border-line/60 bg-panel/50' : 'border-line bg-panel'}`}>
      <div className="flex items-baseline gap-2">
        <span className={`tabular text-display font-bold ${noCls}`}>{no}</span>
        <span className="text-body text-dim">{unit}</span>
        {side && <span className="ml-auto">{side}</span>}
      </div>
      {children}
    </div>
  );
}

// 자리 0·1이 한 팀, 2·3이 상대 — 윗줄 대 아랫줄. 빈자리는 흐린 대시
function Teams({ game }: { game: IGame }) {
  const bySlot = (slot: number) => (game.players ?? []).find((p) => p.slot === slot);
  return (
    <div className="flex flex-col gap-1.5">
      {[
        [0, 1],
        [2, 3],
      ].map((team, i) => (
        <div key={i} className="contents">
          {i === 1 && <span className="self-center text-caption font-bold text-faint">VS</span>}
          <div className="grid grid-cols-2 gap-2">
            {team.map((slot) => (
              <Person key={slot} player={bySlot(slot)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Person({ player }: { player?: IGamePlayer }) {
  const member = player?.attendance?.member;
  if (!member) return <span className="flex h-10 items-center px-1 text-body text-faint">—</span>;
  return (
    <span className="flex h-10 min-w-0 items-center gap-2 rounded-xl bg-panel2 px-3">
      <GradeBadge grade={member.grade} />
      <span className="truncate text-body font-bold">{member.name}</span>
      <GenderMarker gender={member.gender} />
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-line bg-panel p-5 text-center text-body text-faint">{children}</p>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="fade-in flex min-h-dvh w-full flex-col gap-6 px-4 py-4 sm:px-6">{children}</main>;
}
