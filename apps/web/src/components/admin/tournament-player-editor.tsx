'use client';

import { ITournamentDetail, ITournamentMatch, TournamentMatchStatus, TournamentTeam } from '@letscok/shared-types';
import { useState } from 'react';

// 선수 바꾸기 — 바꿀 자리를 고르고, 같은 팀 참가자 가운데 넣을 사람을 고른다
// 넣을 사람이 같은 라운드의 다른 경기에 있으면 그 경기와 맞바꿀 수 있다(둘 다 그 라운드에 한 번씩만 뛰게)

const BTN = 'h-9 rounded-lg px-3 text-sm font-bold transition-opacity disabled:opacity-40';

export function TournamentPlayerEditor({
  detail,
  match,
  busy,
  onReplace,
  onCancel,
}: {
  detail: ITournamentDetail;
  match: ITournamentMatch;
  busy: boolean;
  onReplace: (slot: number, participantId: string, swapMatchId?: string) => void;
  onCancel: () => void;
}) {
  const [slot, setSlot] = useState<number | null>(null);
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
      <p className="text-caption text-dim">바꿀 사람을 고르세요</p>
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
          </button>
        ))}
      </div>
      {out && (
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
