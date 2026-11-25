'use client';

import {
  computeTournamentStandings,
  ITournamentDetail,
  ITournamentMatch,
  ITournamentMatchPlayer,
  ITournamentStandings,
  tournamentOfficialScore,
  TournamentMatchStatus,
  TournamentMatchType,
  TournamentStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import { useMemo, useState } from 'react';

// 대회 현황 부품 — 모임원 화면과 운영석 전광판, 관제판이 같이 쓴다(읽기 전용)

export const TOURNAMENT_TYPE_LABEL: Record<TournamentMatchType, string> = { MENS: '남복', WOMENS: '여복', MIXED: '혼복' };

// 지각 대리 경기 — 대진표의 선수 이름 옆에 대신 뛰는 사람을 적는다
export const tournamentPlayerLabel = (player: ITournamentMatchPlayer) =>
  player.proxyName ? `${player.name}(대리 ${player.proxyName})` : player.name;
export const tournamentBlueNames = (match: ITournamentMatch) => match.players.filter((p) => p.slot < 2).map(tournamentPlayerLabel);
export const tournamentWhiteNames = (match: ITournamentMatch) => match.players.filter((p) => p.slot >= 2).map(tournamentPlayerLabel);

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

// 끝난 대회의 승자 문구 — 승수가 같아 득실점 차이로 갈렸으면 그 사실을 같이 알린다
export function tournamentWinnerText(standings: ITournamentStandings) {
  const { blue, white, leader } = standings;
  return {
    title: leader === null ? '무승부' : `${leader === TournamentTeam.BLUE ? '청팀' : '백팀'} 우승`,
    cls: leader === TournamentTeam.BLUE ? 'text-sky' : 'text-ink',
    note: leader !== null && blue.wins === white.wins ? '승수가 같아 득실점 차이로 가렸어요' : null,
  };
}

// 개인 순위 줄 — 승수와 경기 수가 같으면 같은 순위(tied면 순위 숫자를 비운다)
export function tournamentRankRows(standings: ITournamentStandings) {
  return standings.players.map((player, index, all) => {
    const first = all.findIndex((other) => other.wins === player.wins && other.games === player.games);
    return { player, rank: first + 1, tied: first !== index };
  });
}

// 청백 승수 — 이긴 경기 수가 기준이고, 같으면 득실점 차이로 앞선 팀을 가린다. final: 끝난 대회의 최종 결과
export function TournamentScoreboard({ standings, final = false }: { standings: ITournamentStandings; final?: boolean }) {
  const { blue, white, leader, finished, total } = standings;
  const winner = tournamentWinnerText(standings);
  const leadText = final
    ? (winner.note ?? '')
    : finished === 0
      ? '아직 끝난 경기가 없어요'
      : leader === null
        ? '동률이에요'
        : `${leader === TournamentTeam.BLUE ? '청팀' : '백팀'}이 앞서고 있어요${blue.wins === white.wins ? ' (득실점 차이)' : ''}`;
  const side = (label: string, wins: number, diff: number, cls: string) => (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className={`text-body font-bold ${cls}`}>{label}</span>
      <span className={`text-[3.5rem] leading-none font-bold tabular-nums ${cls}`}>{wins}</span>
      <span className="text-caption text-dim">득실 {signed(diff)}</span>
    </div>
  );
  return (
    <section className={`flex flex-col gap-3 rounded-2xl bg-panel p-5 ${final ? 'border border-court/40' : ''}`}>
      {final && (
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-caption font-bold text-court">최종 결과</span>
          <span className={`text-[2.25rem] leading-tight font-bold ${winner.cls}`}>{winner.title}</span>
        </div>
      )}
      <div className="flex items-center">
        {side('청팀', blue.wins, blue.pointsFor - blue.pointsAgainst, 'text-sky')}
        <span className="text-heading text-faint">:</span>
        {side('백팀', white.wins, white.pointsFor - white.pointsAgainst, 'text-ink')}
      </div>
      <p className="text-center text-sm text-dim">
        {leadText} <span className="text-faint">({total}경기 중 {finished}경기{final ? ' 치름' : ' 끝남'})</span>
      </p>
    </section>
  );
}

export function TournamentMatchNames({ match }: { match: ITournamentMatch }) {
  return (
    <p className="text-sm">
      <span className="font-bold text-sky">{tournamentBlueNames(match).join(', ')}</span>
      <span className="mx-1.5 text-caption text-faint">vs</span>
      <span className="font-bold">{tournamentWhiteNames(match).join(', ')}</span>
    </p>
  );
}

// 코트마다 지금 경기, 없으면 그 코트의 다음 경기
export function TournamentCourts({ detail }: { detail: ITournamentDetail }) {
  const courts = Array.from({ length: detail.tournament.courtCount }, (_, i) => i + 1);
  const queued = detail.matches
    .filter((m) => m.status === TournamentMatchStatus.QUEUED)
    .sort((a, b) => a.queueOrder - b.queueOrder);
  return (
    <ul className="flex flex-col gap-2">
      {courts.map((courtNo) => {
        const current = detail.matches.find((m) => m.status === TournamentMatchStatus.PLAYING && m.courtNo === courtNo);
        const next = queued.find((m) => m.courtNo === courtNo);
        const match = current ?? next;
        return (
          <li key={courtNo} className={`flex flex-col gap-1 rounded-xl p-3 ${current ? 'bg-court/10' : 'bg-panel'}`}>
            <div className="flex items-center gap-2">
              <span className="text-body font-bold">{courtNo}코트</span>
              <span className={`text-caption font-bold ${current ? 'text-court' : 'text-faint'}`}>
                {current ? '경기 중' : next ? '다음 경기' : '남은 경기 없음'}
              </span>
              {match && (
                <span className="ml-auto text-caption text-dim">
                  {match.matchNo}번, {match.round}라운드, {TOURNAMENT_TYPE_LABEL[match.type]}
                </span>
              )}
            </div>
            {match && <TournamentMatchNames match={match} />}
          </li>
        );
      })}
    </ul>
  );
}

// 라운드별 대진표 — 끝난 경기는 점수, 아니면 상태. wide: 운영 화면처럼 넓은 곳에서는 라운드를 두 줄로 나란히
export function TournamentBracket({ detail, wide = false }: { detail: ITournamentDetail; wide?: boolean }) {
  const rounds = [...new Set(detail.matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className={`flex flex-col gap-3 ${wide ? 'lg:grid lg:grid-cols-2 lg:items-start' : ''}`}>
      {rounds.map((round) => (
        <div key={round} className="rounded-xl bg-panel p-3">
          <p className="text-caption font-bold text-dim">{round}라운드</p>
          <ul className="mt-1 flex flex-col">
            {detail.matches
              .filter((m) => m.round === round)
              .map((match) => (
                <li key={match.id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-caption text-dim">
                      {match.matchNo}번, {match.courtNo}코트, {TOURNAMENT_TYPE_LABEL[match.type]}
                    </p>
                    <TournamentMatchNames match={match} />
                  </div>
                  <MatchResult match={match} />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MatchResult({ match }: { match: ITournamentMatch }) {
  if (match.status === TournamentMatchStatus.PLAYING) {
    return <span className="shrink-0 text-caption font-bold text-court">경기 중</span>;
  }
  if (match.status !== TournamentMatchStatus.FINISHED) {
    return <span className="shrink-0 text-caption text-faint">대기</span>;
  }
  return <TournamentScoreText match={match} size="text-body" />;
}

// 끝난 경기의 점수 — 이긴 팀을 굵게. 대리 경기는 집계에 들어가는 점수(결원 팀 0:21)를 보여 준다
export function TournamentScoreText({ match, size }: { match: ITournamentMatch; size: string }) {
  const score = tournamentOfficialScore(match);
  if (!score) return null;
  const blueWon = score.blue > score.white;
  return (
    <p className={`shrink-0 ${size} tabular-nums`}>
      {score.proxy && <span className="mr-1.5 text-caption font-bold text-amber">대리</span>}
      <span className={blueWon ? 'font-bold text-sky' : 'text-faint'}>{score.blue}</span>
      <span className="mx-1 text-caption text-faint">:</span>
      <span className={blueWon ? 'text-faint' : 'font-bold'}>{score.white}</span>
    </p>
  );
}

// 개인 승수 순위 — 사람마다 경기 수가 달라 같이 보여 준다. 승수와 경기 수가 같으면 같은 순위
export function TournamentRanking({ standings }: { standings: ITournamentStandings }) {
  const rows = tournamentRankRows(standings);
  return (
    <ul className="flex flex-col rounded-xl bg-panel px-3">
      {rows.map(({ player, rank, tied }) => (
        <li key={player.participantId} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
          <span className="w-6 shrink-0 text-center text-sm tabular-nums text-dim">{tied ? '' : rank}</span>
          <span className={`text-body font-bold ${player.team === TournamentTeam.BLUE ? 'text-sky' : ''}`}>{player.name}</span>
          <span className="text-caption text-faint">{player.team === TournamentTeam.BLUE ? '청팀' : '백팀'}</span>
          <span className="ml-auto text-sm tabular-nums">
            <span className="font-bold">{player.wins}승</span>
            <span className="ml-1.5 text-dim">{player.games}경기</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const TABS = [
  { key: 'courts', label: '코트 현황' },
  { key: 'bracket', label: '대진표' },
  { key: 'ranking', label: '개인 순위' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// 모임원이 보는 대회 현황 — 점수판은 늘 위에, 아래는 탭으로 나눠 폰에서 길어지지 않게
// 끝난 대회는 최종 결과로 보여 준다 — 코트 현황은 볼 것이 없어 빼고 개인 순위를 먼저 연다
export function TournamentLiveView({ detail }: { detail: ITournamentDetail }) {
  const standings = useMemo(() => computeTournamentStandings(detail), [detail]);
  const closed = detail.tournament.status === TournamentStatus.CLOSED;
  const [picked, setTab] = useState<TabKey>('courts');
  const tab = closed && picked === 'courts' ? 'ranking' : picked;
  return (
    <>
      <header className="flex flex-col items-center gap-1 pt-2 text-center">
        <span className="text-caption font-bold tracking-[0.3em] text-court">LETSCOK</span>
        <h1 className="text-title font-bold">{detail.tournament.name}</h1>
      </header>
      <TournamentScoreboard standings={standings} final={closed} />
      <nav className="flex gap-2">
        {TABS.filter(({ key }) => !closed || key !== 'courts').map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`h-10 flex-1 rounded-lg border text-sm font-bold ${
              tab === key ? 'border-court bg-court/10 text-court' : 'border-line text-dim'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'courts' && <TournamentCourts detail={detail} />}
      {tab === 'bracket' && <TournamentBracket detail={detail} />}
      {tab === 'ranking' && <TournamentRanking standings={standings} />}
    </>
  );
}
