'use client';

import {
  computeTournamentStandings,
  ITournamentDetail,
  ITournamentMatch,
  ITournamentMatchPlayer,
  ITournamentParticipant,
  ITournamentStandings,
  matchesName,
  tournamentOfficialScore,
  TournamentMatchStatus,
  TournamentMatchType,
  TournamentStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { getMemberId } from '@/lib/member';

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
// mineId: 내 경기를 고른 참가자 — 그 사람이 뛰는 경기 줄에 표시를 붙인다
export function TournamentBracket({ detail, wide = false, mineId }: { detail: ITournamentDetail; wide?: boolean; mineId?: string }) {
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
                      {mineId && match.players.some((p) => p.participantId === mineId) && (
                        <span className="ml-1.5 font-bold text-court">내 경기</span>
                      )}
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

// 내 경기를 볼 사람 — 대회 현황은 모두 공개라 이름만 고르면 된다. 평소 모임 때 연결한 폰은 그 회원으로 바로 보여 준다
// 여기서 고른 이름은 대회 화면에만 쓴다(평소 모임의 폰 연결과 별개)
const MINE_KEY = 'letscok:tournament-member-id';

function useMyParticipant(detail: ITournamentDetail) {
  const [memberId, setMemberId] = useState<string | null>(null);
  useEffect(() => setMemberId(localStorage.getItem(MINE_KEY) ?? getMemberId()), []);
  const pick = (next: string | null) => {
    if (next) localStorage.setItem(MINE_KEY, next);
    else localStorage.removeItem(MINE_KEY);
    setMemberId(next);
  };
  return { me: detail.participants.find((p) => p.memberId === memberId) ?? null, pick };
}

function MyMatches({
  detail,
  me,
  onPick,
}: {
  detail: ITournamentDetail;
  me: ITournamentParticipant | null;
  onPick: (memberId: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  if (picking || !me) {
    if (!picking) {
      return (
        <button onClick={() => setPicking(true)} className="h-12 rounded-xl border border-court/40 text-sm font-bold text-court">
          내 경기 보기
        </button>
      );
    }
    const shown = detail.participants.filter((p) => matchesName(p.name, query.trim()));
    return (
      <section className="flex flex-col gap-2 rounded-2xl bg-panel p-4">
        <div className="flex items-center">
          <h2 className="text-body font-bold">내 이름을 골라 주세요</h2>
          <button onClick={() => setPicking(false)} className="ml-auto text-sm text-dim">
            닫기
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름이나 초성으로 찾기"
          className="h-11 rounded-lg border border-line bg-panel2 px-3 text-body outline-none focus:border-court"
        />
        {shown.length === 0 && <p className="text-sm text-faint">찾는 이름이 없어요. 대진표에 있는 사람만 나와요.</p>}
        <ul className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onPick(p.memberId);
                  setPicking(false);
                  setQuery('');
                }}
                className="flex h-11 w-full items-center gap-2 rounded-lg bg-panel2 px-3 text-left"
              >
                <span className={`text-sm font-bold ${p.team === TournamentTeam.BLUE ? 'text-sky' : ''}`}>{p.name}</span>
                <span className="text-caption text-faint">{p.team === TournamentTeam.BLUE ? '청팀' : '백팀'}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const mine = detail.matches.filter((m) => m.players.some((p) => p.participantId === me.id));
  const playing = mine.find((m) => m.status === TournamentMatchStatus.PLAYING);
  const queued = mine.filter((m) => m.status === TournamentMatchStatus.QUEUED).sort((a, b) => a.queueOrder - b.queueOrder);
  const done = mine.filter((m) => m.status === TournamentMatchStatus.FINISHED);
  const blue = me.team === TournamentTeam.BLUE;
  const record = computeTournamentStandings(detail).players.find((p) => p.participantId === me.id);
  const closed = detail.tournament.status === TournamentStatus.CLOSED;
  const next = queued[0];
  // 그 코트에서 내 경기보다 먼저 치를 경기 수 — 지금 하고 있는 경기도 센다
  const ahead = next
    ? detail.matches.filter(
        (m) =>
          m.courtNo === next.courtNo &&
          (m.status === TournamentMatchStatus.PLAYING ||
            (m.status === TournamentMatchStatus.QUEUED && m.queueOrder < next.queueOrder)),
      ).length
    : 0;
  // 같은 편과 상대 — 내 자리에 대리가 있으면 알려 준다
  const sides = (match: ITournamentMatch) => {
    const myTeam = match.players.filter((p) => p.slot < 2 === blue);
    return {
      partner: myTeam.filter((p) => p.participantId !== me.id).map(tournamentPlayerLabel).join(', '),
      rivals: match.players.filter((p) => p.slot < 2 !== blue).map(tournamentPlayerLabel).join(', '),
      proxy: myTeam.find((p) => p.participantId === me.id)?.proxyName ?? null,
    };
  };
  const card = (match: ITournamentMatch, label: string, labelCls: string, note: string) => {
    const { partner, rivals, proxy } = sides(match);
    return (
      <div className="flex flex-col gap-1 rounded-xl bg-panel2 p-3">
        <div className="flex items-baseline gap-2">
          <span className={`text-caption font-bold ${labelCls}`}>{label}</span>
          <span className="text-heading font-bold">{match.courtNo}코트</span>
          <span className="text-sm text-dim">{note}</span>
          <span className="ml-auto text-caption text-dim">
            {match.matchNo}번, {match.round}라운드
          </span>
        </div>
        <p className="text-sm">
          <span className="text-dim">같은 편</span> <span className="font-bold">{partner || '없음'}</span>
          <span className="ml-3 text-dim">상대</span> <span className="font-bold">{rivals}</span>
        </p>
        {proxy && <p className="text-caption text-amber">{proxy} 님이 대신 뛰는 것으로 되어 있어요. 도착했으면 운영진에게 알려 주세요.</p>}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-panel p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-body font-bold">
          <span className={blue ? 'text-sky' : ''}>{me.name}</span> 님의 경기
        </h2>
        {record && record.games > 0 && (
          <span className="text-sm tabular-nums text-dim">
            {record.wins}승 {record.games - record.wins}패
          </span>
        )}
        <button onClick={() => setPicking(true)} className="ml-auto text-caption text-dim underline">
          다른 사람으로
        </button>
      </div>
      {mine.length === 0 && <p className="text-sm text-faint">대진표에 들어 있는 경기가 없어요</p>}
      {playing && card(playing, '경기 중', 'text-court', '지금 경기 중이에요')}
      {!closed && next && card(next, '다음 경기', 'text-amber', playing ? '' : ahead === 0 ? '곧 시작해요' : `앞에 ${ahead}경기`)}
      {!closed && queued.length > 1 && <p className="text-caption text-dim">그 뒤로 {queued.length - 1}경기가 더 남았어요</p>}
      {!closed && mine.length > 0 && !playing && !next && <p className="text-sm text-dim">남은 경기가 없어요. 수고하셨어요!</p>}
      {done.length > 0 && (
        <ul className="flex flex-col">
          {done.map((match) => {
            const score = tournamentOfficialScore(match)!;
            const won = score.blue > score.white === blue;
            return (
              <li key={match.id} className="flex items-center gap-2 border-t border-line py-1.5 text-sm">
                <span className={`w-6 shrink-0 font-bold ${won ? 'text-court' : 'text-faint'}`}>{won ? '승' : '패'}</span>
                <span className="min-w-0 flex-1 truncate text-dim">
                  {match.matchNo}번, 상대 {sides(match).rivals}
                </span>
                <TournamentScoreText match={match} size="text-sm" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  const { me, pick } = useMyParticipant(detail);
  return (
    <>
      <header className="flex flex-col items-center gap-1 pt-2 text-center">
        <span className="text-caption font-bold tracking-[0.3em] text-court">LETSCOK</span>
        <h1 className="text-title font-bold">{detail.tournament.name}</h1>
      </header>
      <TournamentScoreboard standings={standings} final={closed} />
      <MyMatches detail={detail} me={me} onPick={pick} />
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
      {tab === 'bracket' && <TournamentBracket detail={detail} mineId={me?.id} />}
      {tab === 'ranking' && <TournamentRanking standings={standings} />}
    </>
  );
}
