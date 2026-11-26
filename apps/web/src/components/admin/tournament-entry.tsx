'use client';

import { ITournamentDetail, ITournamentParticipant, matchesName, TournamentTeam } from '@letscok/shared-types';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { api, ApiError } from '@/lib/api';

// 입구 체크인 — 이름을 한 번 누르면 입장과 웰컴 키트·타월·추첨권 지급을 한꺼번에 기록한다
// 잘못 눌렀을 때만 [되돌리기](두 번 눌러 확정)
// 추첨 번호는 체크인한 순서로 매겨져 줄에 보인다 — 그 번호의 추첨권을 건넨다. 서로 바꿨거나 꼬였으면 번호를 눌러 고친다

export function TournamentEntry({ detail, onChange }: { detail: ITournamentDetail; onChange: (next: ITournamentDetail) => void }) {
  const { tournament, participants } = detail;
  const [query, setQuery] = useState('');
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numbering, setNumbering] = useState<{ id: string; value: string } | null>(null); // 추첨 번호를 고치는 중인 참가자

  const entered = participants.filter((p) => p.enteredAt !== null).length;
  const shown = participants.filter((p) => matchesName(p.name, query.trim()) && (!waitingOnly || p.enteredAt === null));

  const setEntry = async (participant: ITournamentParticipant, value: boolean) => {
    setBusyId(participant.id);
    setError(null);
    try {
      onChange(
        await api<ITournamentDetail>(`/tournaments/${tournament.id}/participants/${participant.id}/entry`, {
          method: 'PATCH',
          admin: true,
          body: { entered: value },
        }),
      );
      if (value) setQuery(''); // 다음 사람을 바로 찾게
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  // 그 번호를 가진 사람이 있으면 서버가 두 사람의 번호를 맞바꾼다
  const saveNumber = async () => {
    if (!numbering || !/^\d+$/.test(numbering.value) || Number(numbering.value) < 1) return;
    setBusyId(numbering.id);
    setError(null);
    try {
      onChange(
        await api<ITournamentDetail>(`/tournaments/${tournament.id}/participants/${numbering.id}/raffle`, {
          method: 'PATCH',
          admin: true,
          body: { raffleNo: Number(numbering.value) },
        }),
      );
      setNumbering(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 rounded-2xl bg-panel p-5">
        <span className="text-display font-bold tabular-nums text-court">{entered}</span>
        <span className="text-body text-dim">/ {participants.length}명 입장</span>
        <span className="ml-auto text-caption text-faint">누르면 추첨 번호가 나와요. 웰컴 키트, 타월과 그 번호의 추첨권을 건네 주세요</span>
      </div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 찾기 (초성도 돼요)"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 text-body outline-none focus:border-court"
        />
        <button
          onClick={() => setWaitingOnly(!waitingOnly)}
          className={`h-12 shrink-0 rounded-xl border px-4 text-sm font-bold ${
            waitingOnly ? 'border-court bg-court/10 text-court' : 'border-line text-dim'
          }`}
        >
          안 온 사람만
        </button>
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
      {shown.length === 0 && <p className="py-6 text-center text-sm text-faint">해당하는 참가자가 없어요</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((participant) => {
          const isBlue = participant.team === TournamentTeam.BLUE;
          const done = participant.enteredAt !== null;
          const name = (
            <>
              <span className={`text-body font-bold ${isBlue ? 'text-sky' : ''}`}>{participant.name}</span>
              <span className="text-caption text-dim">{isBlue ? '청팀' : '백팀'}</span>
            </>
          );
          return done ? (
            <li key={participant.id} className="flex min-h-14 flex-wrap items-center gap-3 rounded-xl bg-court/10 px-4 py-2">
              {name}
              {numbering?.id === participant.id ? (
                <span className="ml-auto flex items-center gap-2">
                  {(() => {
                    const holder = participants.find((p) => p.id !== participant.id && p.raffleNo === Number(numbering.value));
                    return holder && <span className="text-caption text-amber">{holder.name} 님과 맞바꿔요</span>;
                  })()}
                  <input
                    autoFocus
                    value={numbering.value}
                    onChange={(e) => setNumbering({ id: participant.id, value: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveNumber();
                    }}
                    inputMode="numeric"
                    aria-label={`${participant.name} 추첨 번호`}
                    className="h-9 w-20 rounded-lg border border-line bg-panel px-3 text-body tabular-nums outline-none focus:border-court"
                  />
                  <button onClick={() => void saveNumber()} disabled={busyId !== null} className="h-9 rounded-lg bg-court px-3 text-sm font-bold text-bg disabled:opacity-40">
                    저장
                  </button>
                  <button onClick={() => setNumbering(null)} className="h-9 rounded-lg border border-line px-3 text-sm text-dim">
                    취소
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setNumbering({ id: participant.id, value: String(participant.raffleNo ?? '') })}
                  disabled={busyId !== null}
                  title="추첨 번호 고치기"
                  className="ml-auto h-9 rounded-lg border border-court/40 px-3 text-sm font-bold tabular-nums text-court"
                >
                  추첨 {participant.raffleNo === null ? '번호 없음' : `${participant.raffleNo}번`}
                </button>
              )}
              <ConfirmButton
                label="되돌리기"
                confirmLabel="한 번 더"
                className="h-9 rounded-lg px-3 text-sm font-bold"
                idleCls="border border-line text-dim"
                disabled={busyId !== null}
                onConfirm={() => void setEntry(participant, false)}
              />
            </li>
          ) : (
            <li key={participant.id}>
              <button
                onClick={() => void setEntry(participant, true)}
                disabled={busyId !== null}
                className="flex h-14 w-full items-center gap-3 rounded-xl bg-panel px-4 text-left transition-colors hover:bg-panel2 disabled:opacity-60"
              >
                {name}
                <span className="ml-auto text-sm font-bold text-dim">{busyId === participant.id ? '기록하는 중...' : '체크인'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
