'use client';

import {
  ITournamentDetail,
  ITournamentMatch,
  TOURNAMENT_PLAYER_BUSY,
  TournamentMatchStatus,
  TournamentMatchType,
} from '@letscok/shared-types';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { api, ApiError } from '@/lib/api';

// 대회 경기 진행 — 코트마다 지금 경기와 다음 경기를 보여 주고, 대기 경기를 빈 코트에 올린다

export const TOURNAMENT_TYPE_LABEL: Record<TournamentMatchType, string> = { MENS: '남복', WOMENS: '여복', MIXED: '혼복' };
const SMALL_BTN = 'h-9 rounded-lg px-3 text-sm font-bold transition-opacity disabled:opacity-40';

const blueOf = (match: ITournamentMatch) => match.players.filter((p) => p.slot < 2).map((p) => p.name);
const whiteOf = (match: ITournamentMatch) => match.players.filter((p) => p.slot >= 2).map((p) => p.name);

interface BusyAsk {
  matchId: string;
  courtNo: number;
  message: string;
}

export function TournamentBoard({ detail, onChange }: { detail: ITournamentDetail; onChange: (next: ITournamentDetail) => void }) {
  const { tournament, matches } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<BusyAsk | null>(null); // 선수가 아직 경기 중일 때 — 그래도 시작할지 묻는다
  const [pickingFor, setPickingFor] = useState<string | null>(null); // 코트를 고르는 중인 대기 경기

  const playing = matches.filter((m) => m.status === TournamentMatchStatus.PLAYING);
  const queued = matches
    .filter((m) => m.status === TournamentMatchStatus.QUEUED)
    .sort((a, b) => a.queueOrder - b.queueOrder);
  const courts = Array.from({ length: tournament.courtCount }, (_, i) => i + 1);
  const emptyCourts = courts.filter((no) => !playing.some((m) => m.courtNo === no));
  const base = `/tournaments/${tournament.id}/matches`;

  const run = async (request: () => Promise<ITournamentDetail>, onBusy?: (message: string) => void) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await request());
      setAsk(null);
      setPickingFor(null);
    } catch (e) {
      if (onBusy && e instanceof ApiError && e.code === TOURNAMENT_PLAYER_BUSY) onBusy(e.message);
      else setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const start = (matchId: string, courtNo: number, force = false) =>
    run(
      () => api<ITournamentDetail>(`${base}/${matchId}/start`, { method: 'POST', admin: true, body: { courtNo, force } }),
      (message) => setAsk({ matchId, courtNo, message }),
    );
  const cancelStart = (matchId: string) =>
    run(() => api<ITournamentDetail>(`${base}/${matchId}/cancel-start`, { method: 'POST', admin: true }));

  return (
    <section className="flex flex-col gap-4">
      {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      {ask && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm text-amber">
          <p>
            <span className="font-bold">확인해 주세요</span> {ask.message}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void start(ask.matchId, ask.courtNo, true)}
              disabled={busy}
              className={`${SMALL_BTN} bg-amber text-bg`}
            >
              그래도 {ask.courtNo}코트에 올리기
            </button>
            <button onClick={() => setAsk(null)} className={`${SMALL_BTN} border border-line text-dim`}>
              취소
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {courts.map((courtNo) => {
          const current = playing.find((m) => m.courtNo === courtNo);
          const next = queued.find((m) => m.courtNo === courtNo);
          return (
            <div key={courtNo} className={`flex flex-col gap-2 rounded-2xl p-4 ${current ? 'bg-court/10' : 'bg-panel'}`}>
              <div className="flex items-center gap-2">
                <h3 className="text-body font-bold">{courtNo}코트</h3>
                <span className={`text-caption font-bold ${current ? 'text-court' : 'text-faint'}`}>
                  {current ? '경기 중' : '비어 있음'}
                </span>
              </div>
              {current ? (
                <>
                  <MatchNames match={current} />
                  <ConfirmButton
                    label="대기로 돌리기"
                    confirmLabel="한 번 더 누르면 대기로"
                    className={`${SMALL_BTN} self-start`}
                    idleCls="border border-line text-dim"
                    disabled={busy}
                    onConfirm={() => void cancelStart(current.id)}
                  />
                </>
              ) : next ? (
                <>
                  <p className="text-caption text-dim">다음 경기</p>
                  <MatchNames match={next} />
                  <button onClick={() => void start(next.id, courtNo)} disabled={busy} className={`${SMALL_BTN} self-start bg-court text-bg`}>
                    시작
                  </button>
                </>
              ) : (
                <p className="text-sm text-faint">이 코트에 남은 경기가 없어요</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-body-sm font-bold text-dim">대기 경기 {queued.length}건</h2>
        {queued.length === 0 && <p className="text-sm text-faint">대기 중인 경기가 없어요</p>}
        <ul className="flex flex-col gap-2">
          {queued.map((match) => (
            <li key={match.id} className="flex flex-col gap-2 rounded-xl bg-panel p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <MatchNames match={match} showCourt />
                </div>
                <button
                  onClick={() => setPickingFor(pickingFor === match.id ? null : match.id)}
                  disabled={busy || emptyCourts.length === 0}
                  title={emptyCourts.length === 0 ? '빈 코트가 없어요' : undefined}
                  className={`${SMALL_BTN} shrink-0 border border-line text-dim`}
                >
                  코트 고르기
                </button>
              </div>
              {pickingFor === match.id && (
                <div className="flex flex-wrap gap-2">
                  {emptyCourts.map((courtNo) => (
                    <button
                      key={courtNo}
                      onClick={() => void start(match.id, courtNo)}
                      disabled={busy}
                      className={`${SMALL_BTN} ${courtNo === match.courtNo ? 'bg-court text-bg' : 'border border-court/50 text-court'}`}
                    >
                      {courtNo}코트
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MatchNames({ match, showCourt = false }: { match: ITournamentMatch; showCourt?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-caption text-dim">
        {match.matchNo}번, {match.round}라운드, {TOURNAMENT_TYPE_LABEL[match.type]}
        {showCourt && `, ${match.courtNo}코트 예정`}
      </p>
      <p className="text-sm">
        <span className="font-bold text-sky">{blueOf(match).join(', ')}</span>
        <span className="mx-1.5 text-caption text-faint">vs</span>
        <span className="font-bold">{whiteOf(match).join(', ')}</span>
      </p>
    </div>
  );
}
