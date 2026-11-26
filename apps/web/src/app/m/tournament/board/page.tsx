'use client';

// 운영석 전광판 — 모니터에 띄워 두는 화면. 위에 청백 승수, 아래에 코트별 지금 경기와 다음 경기
// 만질 것이 없고, 대회가 바뀌면 저절로 바뀐다. 글자 크기는 화면 높이에 맞춘다(모니터 크기가 달라도 한 화면에 들어가게)

import {
  computeTournamentStandings,
  ITournamentDetail,
  ITournamentMatch,
  TournamentMatchStatus,
  TournamentStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import { useMemo } from 'react';
import {
  TOURNAMENT_TYPE_LABEL,
  tournamentBlueNames,
  tournamentRankRows,
  tournamentWhiteNames,
  tournamentWinnerText,
} from '@/components/tournament-live';
import { useTournamentLive } from '@/lib/use-tournament-live';

export default function TournamentBoardPage() {
  const { detail, loading, stale } = useTournamentLive();
  if (!detail) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-[2vh] text-center">
        <span className="text-[2.5vh] font-bold tracking-[0.3em] text-court">LETSCOK</span>
        <h1 className="text-[6vh] font-bold">{loading ? '불러오는 중...' : '대회가 시작되면 여기에 현황이 나와요'}</h1>
      </main>
    );
  }
  return (
    <>
      {stale && (
        <span className="fixed top-[1.5vh] right-[1.5vh] z-10 rounded-[1.5vh] bg-coral px-[2vh] py-[1vh] text-[2.2vh] font-bold text-bg">
          연결 끊김, 다시 연결하는 중
        </span>
      )}
      {detail.tournament.status === TournamentStatus.CLOSED ? <FinalBoard detail={detail} /> : <Board detail={detail} />}
    </>
  );
}

// 끝난 대회의 최종 결과 — 위에 이긴 팀과 청백 승수, 아래에 개인 순위 앞쪽. 시상할 때 띄워 둔다
const FINAL_RANK_ROWS = 8;
function FinalBoard({ detail }: { detail: ITournamentDetail }) {
  const standings = useMemo(() => computeTournamentStandings(detail), [detail]);
  const { blue, white, finished } = standings;
  const winner = tournamentWinnerText(standings);
  // 한 경기도 뛰지 않은 사람(불참)은 순위에서 뺀다
  const rows = tournamentRankRows(standings)
    .filter(({ player }) => player.games > 0)
    .slice(0, FINAL_RANK_ROWS);
  const half = Math.ceil(rows.length / 2);
  return (
    <main className="flex h-dvh flex-col gap-[2vh] overflow-hidden p-[2.5vh]">
      <section className="flex shrink-0 flex-col items-center gap-[1vh] rounded-[3vh] bg-panel px-[4vh] py-[3vh] text-center">
        <span className="text-[2vh] font-bold tracking-[0.3em] text-court">LETSCOK</span>
        <span className="text-[3vh] font-bold text-dim">{detail.tournament.name} 최종 결과</span>
        <span className={`text-[13vh] leading-none font-bold ${winner.cls}`}>{winner.title}</span>
        <div className="flex w-full items-center">
          <TeamScore label="청팀" wins={blue.wins} diff={blue.pointsFor - blue.pointsAgainst} cls="text-sky" />
          <span className="text-[6vh] text-faint">:</span>
          <TeamScore label="백팀" wins={white.wins} diff={white.pointsFor - white.pointsAgainst} cls="text-ink" />
        </div>
        <span className="text-[2.2vh] text-faint">
          {winner.note ? `${winner.note}, ` : ''}
          {finished}경기 치름
        </span>
      </section>
      <section className="flex min-h-0 flex-1 flex-col gap-[1.5vh] rounded-[3vh] bg-panel px-[4vh] py-[2.5vh]">
        <span className="text-[2.6vh] font-bold text-dim">개인 순위</span>
        {rows.length === 0 && <p className="text-[2.6vh] text-faint">끝난 경기가 없어요</p>}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-[6vh]">
          {[rows.slice(0, half), rows.slice(half)].map((column, index) => (
            <ul key={index} className="flex min-h-0 flex-col justify-around">
              {column.map(({ player, rank, tied }) => (
                <li key={player.participantId} className="flex items-baseline gap-[2vh] text-[4vh] leading-tight">
                  <span className="w-[5vh] shrink-0 text-center tabular-nums text-dim">{tied ? '' : rank}</span>
                  <span className={`truncate font-bold ${player.team === TournamentTeam.BLUE ? 'text-sky' : ''}`}>{player.name}</span>
                  <span className="ml-auto shrink-0 tabular-nums">
                    <span className="font-bold">{player.wins}승</span>
                    <span className="ml-[1.5vh] text-[2.6vh] text-dim">{player.games}경기</span>
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>
    </main>
  );
}

function Board({ detail }: { detail: ITournamentDetail }) {
  const standings = useMemo(() => computeTournamentStandings(detail), [detail]);
  const { blue, white, leader, finished } = standings;
  const courts = Array.from({ length: detail.tournament.courtCount }, (_, i) => i + 1);
  const queued = detail.matches
    .filter((m) => m.status === TournamentMatchStatus.QUEUED)
    .sort((a, b) => a.queueOrder - b.queueOrder);
  const columns = Math.max(1, Math.ceil(courts.length / 2)); // 두 줄로 나눠 놓는다 — 코트 6개면 3칸씩
  const leadText =
    finished === 0
      ? '곧 시작해요'
      : leader === null
        ? '동률'
        : `${leader === TournamentTeam.BLUE ? '청팀' : '백팀'} 우세${blue.wins === white.wins ? ' (득실점 차이)' : ''}`;

  return (
    <main className="flex h-dvh flex-col gap-[2vh] overflow-hidden p-[2.5vh]">
      <section className="flex shrink-0 items-center rounded-[3vh] bg-panel px-[4vh] py-[2vh]">
        <TeamScore label="청팀" wins={blue.wins} diff={blue.pointsFor - blue.pointsAgainst} cls="text-sky" />
        <div className="flex flex-col items-center gap-[0.5vh] px-[3vh] text-center">
          <span className="text-[2vh] font-bold tracking-[0.3em] text-court">LETSCOK</span>
          <span className="text-[3.5vh] font-bold">{detail.tournament.name}</span>
          <span className="text-[2.5vh] text-dim">{leadText}</span>
          <span className="text-[2vh] text-faint">
            {finished}경기 끝남
          </span>
        </div>
        <TeamScore label="백팀" wins={white.wins} diff={white.pointsFor - white.pointsAgainst} cls="text-ink" />
      </section>

      <section className="grid min-h-0 flex-1 gap-[2vh]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {courts.map((courtNo) => {
          const current = detail.matches.find((m) => m.status === TournamentMatchStatus.PLAYING && m.courtNo === courtNo);
          const next = queued.find((m) => m.courtNo === courtNo);
          return (
            <div
              key={courtNo}
              className={`flex min-h-0 flex-col gap-[1vh] overflow-hidden rounded-[2.5vh] p-[2vh] ${current ? 'bg-court/10' : 'bg-panel'}`}
            >
              <div className="flex items-baseline gap-[1.5vh]">
                <span className="text-[4vh] leading-none font-bold">{courtNo}코트</span>
                <span className={`text-[2.2vh] font-bold ${current ? 'text-court' : 'text-faint'}`}>{current ? '경기 중' : '비어 있음'}</span>
                {current && <MatchMeta match={current} />}
              </div>
              {current ? (
                <Names match={current} size="text-[4vh]" stacked />
              ) : (
                <p className="text-[2.6vh] text-faint">{next ? '다음 경기를 기다리는 중' : '남은 경기가 없어요'}</p>
              )}
              {next && (
                <div className="mt-auto flex flex-col gap-[0.5vh] border-t border-line pt-[1vh]">
                  <div className="flex items-baseline gap-[1.5vh]">
                    <span className="text-[2vh] font-bold text-amber">다음</span>
                    <MatchMeta match={next} />
                  </div>
                  <Names match={next} size="text-[2.4vh]" />
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}

function TeamScore({ label, wins, diff, cls }: { label: string; wins: number; diff: number; cls: string }) {
  return (
    <div className={`flex flex-1 items-center justify-center gap-[3vh] ${cls}`}>
      <span className="text-[6vh] font-bold">{label}</span>
      <span className="text-[16vh] leading-none font-bold tabular-nums">{wins}</span>
      <span className="text-[2.5vh] text-dim">득실 {diff > 0 ? `+${diff}` : diff}</span>
    </div>
  );
}

function MatchMeta({ match }: { match: ITournamentMatch }) {
  return (
    <span className="ml-auto text-[1.9vh] text-dim">
      {match.matchNo}번, {match.round}라운드, {TOURNAMENT_TYPE_LABEL[match.type]}
    </span>
  );
}

// stacked: 진행 중인 경기 — 청팀과 백팀을 한 줄씩 나눠 멀리서도 편이 읽히게
function Names({ match, size, stacked = false }: { match: ITournamentMatch; size: string; stacked?: boolean }) {
  const blue = tournamentBlueNames(match).join(', ');
  const white = tournamentWhiteNames(match).join(', ');
  if (stacked) {
    return (
      <div className={`${size} flex flex-col gap-[0.8vh] text-center leading-tight font-bold`}>
        <span className="truncate text-sky">{blue}</span>
        {/* 두 팀 사이 가로선 가운데에 vs — 왼쪽에 작게 떠 있으면 어느 줄에 붙은 글자인지 읽히지 않는다 */}
        <span className="flex items-center gap-[1.2vh] text-[0.45em] font-normal text-faint">
          <span className="h-px flex-1 bg-line" />
          vs
          <span className="h-px flex-1 bg-line" />
        </span>
        <span className="truncate">{white}</span>
      </div>
    );
  }
  return (
    <p className={`${size} flex items-center gap-[1.2vh] leading-tight font-bold`}>
      <span className="truncate text-sky">{blue}</span>
      {/* 작은 글자라 아랫선에 맞추면 처져 보인다 — 이름의 세로 가운데에 둔다 */}
      <span className="shrink-0 text-[0.6em] font-normal text-faint">vs</span>
      <span className="truncate">{white}</span>
    </p>
  );
}
