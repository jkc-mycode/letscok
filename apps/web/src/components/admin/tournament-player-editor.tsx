'use client';

import {
  IMemberSummary,
  ITournamentDetail,
  ITournamentMatch,
  matchesName,
  MemberRole,
  TournamentMatchStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// 선수 바꾸기 — 바꿀 자리를 고르고, 같은 팀 참가자 가운데 넣을 사람을 고른다
// 넣을 사람이 같은 라운드의 다른 경기에 있으면 그 경기와 맞바꿀 수 있다(둘 다 그 라운드에 한 번씩만 뛰게)
// 지각이면 선수는 그대로 두고 대신 뛸 사람(대리)만 적는다. 끝난 경기는 대리 표시만 고친다(proxyOnly)

const BTN = 'h-9 rounded-lg px-3 text-sm font-bold transition-opacity disabled:opacity-40';

export function TournamentPlayerEditor({
  detail,
  match,
  busy,
  proxyOnly = false,
  onReplace,
  onProxy,
  onCancel,
}: {
  detail: ITournamentDetail;
  match: ITournamentMatch;
  busy: boolean;
  proxyOnly?: boolean;
  onReplace: (slot: number, participantId: string, swapMatchId?: string) => void;
  onProxy: (slot: number, memberId: string | null) => void;
  onCancel: () => void;
}) {
  const [slot, setSlot] = useState<number | null>(null);
  const [proxyOpen, setProxyOpen] = useState(proxyOnly);
  const out = match.players.find((player) => player.slot === slot) ?? null;
  const team = slot === null ? null : slot < 2 ? TournamentTeam.BLUE : TournamentTeam.WHITE;
  const inMatch = new Set(match.players.map((player) => player.participantId));
  const candidates = detail.participants.filter((p) => p.team === team && !inMatch.has(p.id));
  // 같은 라운드에서 그 사람이 들어 있는, 아직 끝나지 않은 다른 경기 — 맞바꿀 상대 경기
  const sameRoundMatch = (participantId: string) =>
    detail.matches.find(
      (m) =>
        m.id !== match.id &&
        m.round === match.round &&
        m.status !== TournamentMatchStatus.FINISHED &&
        m.players.some((player) => player.participantId === participantId),
    );

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel2 p-3">
      <p className="text-caption text-dim">{proxyOnly ? '대리가 뛴 자리를 고르세요' : '바꿀 사람을 고르세요'}</p>
      <div className="grid grid-cols-2 gap-2">
        {match.players.map((player) => (
          <button
            key={player.slot}
            onClick={() => setSlot(player.slot)}
            className={`${BTN} border ${
              slot === player.slot ? 'border-court bg-court/15 text-court' : `border-line ${player.slot < 2 ? 'text-sky' : 'text-ink'}`
            }`}
          >
            {player.name}
            {player.proxyName && <span className="ml-1 text-caption text-amber">대리 {player.proxyName}</span>}
          </button>
        ))}
      </div>
      {out && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber/40 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-caption text-dim">
              {out.proxyName ? `${out.name} 님 대신 ${out.proxyName} 님이 뛰어요` : `${out.name} 님이 늦으면 대신 뛸 사람을 넣어요`}
            </p>
            <span className="ml-auto flex gap-2">
              {out.proxyName && (
                <button onClick={() => onProxy(out.slot, null)} disabled={busy} className={`${BTN} border border-line text-dim`}>
                  대리 빼기
                </button>
              )}
              {!proxyOnly && (
                <button onClick={() => setProxyOpen(!proxyOpen)} className={`${BTN} border border-amber/50 text-amber`}>
                  {out.proxyName ? '대리 바꾸기' : '지각 대리 넣기'}
                </button>
              )}
            </span>
          </div>
          <p className="text-caption text-faint">대리가 뛴 팀은 0:21 패배로 계산하고, 이 경기는 개인 순위에서 빠져요</p>
          {proxyOpen && (
            <ProxyPicker detail={detail} match={match} busy={busy} onPick={(memberId) => onProxy(out.slot, memberId)} />
          )}
        </div>
      )}
      {out && !proxyOnly && (
        <>
          <p className="text-caption text-dim">
            {out.name} 님 대신 넣을 {team === TournamentTeam.BLUE ? '청팀' : '백팀'} 사람
          </p>
          {candidates.length === 0 && <p className="text-sm text-faint">넣을 수 있는 사람이 없어요</p>}
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {candidates.map((candidate) => {
              const other = sameRoundMatch(candidate.id);
              return (
                <li key={candidate.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel px-3 py-2">
                  <span className="text-sm font-bold">{candidate.name}</span>
                  {other && (
                    <span className="text-caption text-amber">
                      {match.round}라운드 {other.matchNo}번에 있음
                    </span>
                  )}
                  <span className="ml-auto flex gap-2">
                    {other && (
                      <button
                        onClick={() => onReplace(out.slot, candidate.id, other.id)}
                        disabled={busy}
                        className={`${BTN} bg-court text-bg`}
                      >
                        {other.matchNo}번과 맞바꾸기
                      </button>
                    )}
                    <button
                      onClick={() => onReplace(out.slot, candidate.id)}
                      disabled={busy}
                      className={`${BTN} ${other ? 'border border-line text-dim' : 'bg-court text-bg'}`}
                    >
                      넣기
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button onClick={onCancel} className={`${BTN} self-start border border-line text-dim`}>
        닫기
      </button>
    </div>
  );
}

// 대신 뛸 회원 고르기 — 모임장과 운영진을 먼저 보여 주고, 이 경기의 선수는 뺀다
function ProxyPicker({
  detail,
  match,
  busy,
  onPick,
}: {
  detail: ITournamentDetail;
  match: ITournamentMatch;
  busy: boolean;
  onPick: (memberId: string) => void;
}) {
  const [members, setMembers] = useState<IMemberSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    api<IMemberSummary[]>('/members', { admin: true })
      .then(setMembers)
      .catch(() => setFailed(true));
  }, []);

  const inMatch = new Set(match.players.map((player) => player.participantId));
  const playing = new Set(detail.participants.filter((p) => inMatch.has(p.id)).map((p) => p.memberId));
  const isStaff = (member: IMemberSummary) => member.role !== MemberRole.MEMBER;
  const shown = (members ?? [])
    .filter((m) => m.deletedAt === null && !m.isGuest && !playing.has(m.id) && matchesName(m.name, query.trim()))
    .sort((a, b) => Number(isStaff(b)) - Number(isStaff(a)) || a.name.localeCompare(b.name, 'ko'));

  if (failed) return <p className="text-sm text-coral">회원 명단을 불러오지 못했어요. 닫았다가 다시 열어 주세요.</p>;
  if (!members) return <p className="text-sm text-faint">회원 명단을 불러오는 중이에요</p>;
  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름이나 초성으로 찾기"
        className="h-10 rounded-lg border border-line bg-panel px-3 text-body outline-none focus:border-court"
      />
      {shown.length === 0 && <p className="text-sm text-faint">찾는 사람이 없어요</p>}
      <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {shown.map((member) => (
          <li key={member.id} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2">
            <span className="text-sm font-bold">{member.name}</span>
            {isStaff(member) && <span className="text-caption text-court">{member.role === MemberRole.LEADER ? '모임장' : '운영진'}</span>}
            <button onClick={() => onPick(member.id)} disabled={busy} className={`${BTN} ml-auto bg-amber text-bg`}>
              대리로 넣기
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
