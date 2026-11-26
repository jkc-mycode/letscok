'use client';

import {
  ITournamentDetail,
  ITournamentMatch,
  TOURNAMENT_PLAYER_BUSY,
  TOURNAMENT_WIN_SCORE,
  TournamentMatchStatus,
  TournamentTeam,
} from '@letscok/shared-types';
import { useEffect, useRef, useState } from 'react';
import { TournamentPlayerEditor } from '@/components/admin/tournament-player-editor';
import { ConfirmButton } from '@/components/confirm-button';
import { Sheet } from '@/components/sheet';
import { TOURNAMENT_TYPE_LABEL, tournamentBlueNames, tournamentWhiteNames, TournamentScoreText } from '@/components/tournament-live';
import { api, ApiError } from '@/lib/api';

// 대회 경기 진행 — 코트마다 지금 경기와 다음 경기를 보여 주고, 대기 경기를 빈 코트에 올리고, 점수를 넣고 고친다
// 대기 경기는 순서를 바꾸고, 대기·진행 중 경기는 선수를 바꾼다. 지각 대리는 끝난 경기에도 표시할 수 있다

export { TOURNAMENT_TYPE_LABEL };
const SMALL_BTN = 'h-9 rounded-lg px-3 text-sm font-bold transition-opacity disabled:opacity-40';

// 겹침 경고 — 서버가 알린 내용을 보여 주고, 그래도 하겠다고 하면 force로 다시 보낸다
interface BusyAsk {
  message: string;
  label: string;
  retry: () => void;
}

export function TournamentBoard({ detail, onChange }: { detail: ITournamentDetail; onChange: (next: ITournamentDetail) => void }) {
  const { tournament, matches } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<BusyAsk | null>(null);
  const [editingFor, setEditingFor] = useState<string | null>(null); // 선수를 바꾸는 중인 경기
  // 경고와 오류는 화면 위쪽에 뜬다 — 긴 대기 목록 아래에서 눌렀어도 보이게 그쪽으로 올린다
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ask || error) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [ask, error]);
  const [pickingFor, setPickingFor] = useState<string | null>(null); // 코트를 고르는 중인 대기 경기
  const [scoringFor, setScoringFor] = useState<string | null>(null); // 점수를 넣거나 고치는 중인 경기

  const playing = matches.filter((m) => m.status === TournamentMatchStatus.PLAYING);
  const queued = matches
    .filter((m) => m.status === TournamentMatchStatus.QUEUED)
    .sort((a, b) => a.queueOrder - b.queueOrder || a.matchNo - b.matchNo); // 점수를 지워 돌아온 경기는 순서 번호가 겹칠 수 있다
  // 방금 끝난 경기가 위로
  const finished = matches
    .filter((m) => m.status === TournamentMatchStatus.FINISHED)
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  const courts = Array.from({ length: tournament.courtCount }, (_, i) => i + 1);
  const emptyCourts = courts.filter((no) => !playing.some((m) => m.courtNo === no));
  const base = `/tournaments/${tournament.id}/matches`;

  // keepEditor: 참가자 추가처럼 선수 바꾸기 창을 연 채로 이어서 할 일이 남는 요청
  const run = async (request: () => Promise<ITournamentDetail>, onBusy?: (message: string) => void, keepEditor = false) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await request());
      setAsk(null);
      setPickingFor(null);
      setScoringFor(null);
      if (!keepEditor) setEditingFor(null);
    } catch (e) {
      if (onBusy && e instanceof ApiError && e.code === TOURNAMENT_PLAYER_BUSY) onBusy(e.message);
      else setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const start = (matchId: string, courtNo: number, force = false): Promise<void> =>
    run(
      () => api<ITournamentDetail>(`${base}/${matchId}/start`, { method: 'POST', admin: true, body: { courtNo, force } }),
      (message) => setAsk({ message, label: `그래도 ${courtNo}코트에 올리기`, retry: () => void start(matchId, courtNo, true) }),
    );
  const replacePlayer = (matchId: string, slot: number, participantId: string, swapMatchId?: string, force = false): Promise<void> =>
    run(
      () =>
        api<ITournamentDetail>(`${base}/${matchId}/players/${slot}`, {
          method: 'PUT',
          admin: true,
          body: { participantId, swapMatchId, force },
        }),
      (message) => setAsk({ message, label: '그래도 바꾸기', retry: () => void replacePlayer(matchId, slot, participantId, swapMatchId, true) }),
    );
  // 지각 대리 — memberId가 null이면 대리 표시를 지운다
  const setProxy = (matchId: string, slot: number, memberId: string | null) =>
    run(() =>
      memberId
        ? api<ITournamentDetail>(`${base}/${matchId}/players/${slot}/proxy`, { method: 'PUT', admin: true, body: { memberId } })
        : api<ITournamentDetail>(`${base}/${matchId}/players/${slot}/proxy`, { method: 'DELETE', admin: true }),
    );
  // 대기 목록에서 한 칸 위·아래로 — 대기 경기 전부의 새 순서를 보낸다
  const move = (index: number, delta: -1 | 1) => {
    const ids = queued.map((m) => m.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    return run(() => api<ITournamentDetail>(`${base}/order`, { method: 'PUT', admin: true, body: { matchIds: ids } }));
  };
  const toggleEditing = (matchId: string) => {
    setEditingFor(editingFor === matchId ? null : matchId);
    setScoringFor(null);
    setPickingFor(null);
  };
  // 대진표에 없는 회원을 참가자로 올린다(당일 대타) — 잘못 올렸으면 뺀다
  const tournamentPath = `/tournaments/${detail.tournament.id}/participants`;
  const addParticipant = (memberId: string, team: TournamentTeam) =>
    run(() => api<ITournamentDetail>(tournamentPath, { method: 'POST', admin: true, body: { memberId, team } }), undefined, true);
  const removeParticipant = (participantId: string) =>
    run(() => api<ITournamentDetail>(`${tournamentPath}/${participantId}`, { method: 'DELETE', admin: true }), undefined, true);
  const cancelStart = (matchId: string) =>
    run(() => api<ITournamentDetail>(`${base}/${matchId}/cancel-start`, { method: 'POST', admin: true }));
  const setScore = (matchId: string, blueScore: number, whiteScore: number) =>
    run(() => api<ITournamentDetail>(`${base}/${matchId}/score`, { method: 'PUT', admin: true, body: { blueScore, whiteScore } }));
  const clearScore = (matchId: string) =>
    run(() => api<ITournamentDetail>(`${base}/${matchId}/score`, { method: 'DELETE', admin: true }));
  const toggleScoring = (matchId: string) => {
    setScoringFor(scoringFor === matchId ? null : matchId);
    setPickingFor(null);
    setEditingFor(null);
  };
  // 오류와 겹침 경고 — 점수 입력이나 선수 바꾸기 팝업이 열려 있으면 가려지므로 팝업 안에 보여 준다
  const notice = (
    <>
      {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      {ask && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm text-amber">
          <p>
            <span className="font-bold">확인해 주세요</span> {ask.message}
          </p>
          <div className="flex gap-2">
            <button onClick={ask.retry} disabled={busy} className={`${SMALL_BTN} bg-amber text-bg`}>
              {ask.label}
            </button>
            <button onClick={() => setAsk(null)} className={`${SMALL_BTN} border border-line text-dim`}>
              취소
            </button>
          </div>
        </div>
      )}
    </>
  );
  const editing = matches.find((m) => m.id === editingFor) ?? null;
  const scoring = matches.find((m) => m.id === scoringFor) ?? null;

  return (
    <section className="flex flex-col gap-4">
      <div ref={noticeRef} />
      {!editing && !scoring && notice}

      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {courts.map((courtNo) => {
          const current = playing.find((m) => m.courtNo === courtNo);
          const next = queued.find((m) => m.courtNo === courtNo);
          return (
            <div key={courtNo} className={`flex min-h-[9.25rem] flex-col gap-2 rounded-2xl p-4 ${current ? 'bg-court/10' : 'bg-panel'}`}>
              <div className="flex items-center gap-2">
                <h3 className="text-body font-bold">{courtNo}코트</h3>
                <span className={`text-caption font-bold ${current ? 'text-court' : 'text-faint'}`}>
                  {current ? '경기 중' : next ? '비어 있음, 다음 경기' : '비어 있음'}
                </span>
              </div>
              {current ? (
                <>
                  <MatchNames match={current} />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => toggleScoring(current.id)} disabled={busy} className={`${SMALL_BTN} bg-court text-bg`}>
                      점수 입력
                    </button>
                    <ConfirmButton
                      label="대기로 돌리기"
                      confirmLabel="한 번 더 누르면 대기로"
                      className={SMALL_BTN}
                      idleCls="border border-line text-dim"
                      disabled={busy}
                      onConfirm={() => void cancelStart(current.id)}
                    />
                    <button onClick={() => toggleEditing(current.id)} disabled={busy} className={`${SMALL_BTN} border border-line text-dim`}>
                      선수 바꾸기
                    </button>
                  </div>
                </>
              ) : next ? (
                <>
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

      {/* 넓은 화면에서는 대기 경기와 끝난 경기를 나란히 둔다 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-2">
        <h2 className="text-body-sm font-bold text-dim">대기 경기 {queued.length}건</h2>
        {queued.length === 0 && <p className="text-sm text-faint">대기 중인 경기가 없어요</p>}
        <ul className="flex flex-col gap-2">
          {queued.map((match, index) => (
            <li key={match.id} className="flex flex-col gap-2 rounded-xl bg-panel p-3">
              <MatchNames match={match} showCourt />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void move(index, -1)}
                  disabled={busy || index === 0}
                  aria-label="순서 위로"
                  className={`${SMALL_BTN} border border-line text-dim`}
                >
                  ▲
                </button>
                <button
                  onClick={() => void move(index, 1)}
                  disabled={busy || index === queued.length - 1}
                  aria-label="순서 아래로"
                  className={`${SMALL_BTN} border border-line text-dim`}
                >
                  ▼
                </button>
                <button
                  onClick={() => {
                    setPickingFor(pickingFor === match.id ? null : match.id);
                    setScoringFor(null);
                    setEditingFor(null);
                  }}
                  disabled={busy || emptyCourts.length === 0}
                  title={emptyCourts.length === 0 ? '빈 코트가 없어요' : undefined}
                  className={`${SMALL_BTN} ml-auto shrink-0 border border-line text-dim`}
                >
                  코트 고르기
                </button>
                {/* 코트에 올리지 않고 치른 경기 — 점수를 바로 넣는다 */}
                <button onClick={() => toggleScoring(match.id)} disabled={busy} className={`${SMALL_BTN} shrink-0 border border-line text-dim`}>
                  점수
                </button>
                <button onClick={() => toggleEditing(match.id)} disabled={busy} className={`${SMALL_BTN} shrink-0 border border-line text-dim`}>
                  선수 바꾸기
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

      <div className="flex flex-col gap-2">
        <h2 className="text-body-sm font-bold text-dim">끝난 경기 {finished.length}건</h2>
        {finished.length === 0 && <p className="text-sm text-faint">아직 끝난 경기가 없어요</p>}
        <ul className="flex flex-col gap-2">
          {finished.map((match) => (
            <li key={match.id} className="flex flex-col gap-2 rounded-xl bg-panel p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <MatchNames match={match} />
                </div>
                <TournamentScoreText match={match} size="text-heading" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => toggleScoring(match.id)} disabled={busy} className={`${SMALL_BTN} border border-line text-dim`}>
                  점수 고치기
                </button>
                <ConfirmButton
                  label="점수 지우기"
                  confirmLabel="지우면 대기 경기로 돌아가요. 한 번 더"
                  className={SMALL_BTN}
                  idleCls="border border-line text-dim"
                  disabled={busy}
                  onConfirm={() => void clearScore(match.id)}
                />
                <button onClick={() => toggleEditing(match.id)} disabled={busy} className={`${SMALL_BTN} border border-line text-dim`}>
                  대리 표시
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      </div>
      {scoring && (
        <ScoreForm
          key={scoring.id}
          match={scoring}
          busy={busy}
          notice={notice}
          onSubmit={(blueScore, whiteScore) => void setScore(scoring.id, blueScore, whiteScore)}
          onCancel={() => {
            setScoringFor(null);
            setError(null);
          }}
        />
      )}
      {editing && (
        <TournamentPlayerEditor
          key={editing.id}
          detail={detail}
          match={editing}
          busy={busy}
          proxyOnly={editing.status === TournamentMatchStatus.FINISHED}
          notice={notice}
          onProxy={(slot, memberId) => void setProxy(editing.id, slot, memberId)}
          onAddParticipant={(memberId, team) => void addParticipant(memberId, team)}
          onRemoveParticipant={(participantId) => void removeParticipant(participantId)}
          onReplace={(slot, participantId, swapMatchId) => void replacePlayer(editing.id, slot, participantId, swapMatchId)}
          onCancel={() => {
            setEditingFor(null);
            setAsk(null);
            setError(null);
          }}
        />
      )}
    </section>
  );
}

// 점수 입력 팝업 — 21점 단판이라 이긴 팀은 늘 21점이므로, 이긴 팀을 고르고 진 팀 점수만 넣는다. 어느 경기인지 제목과 팀 버튼의 이름으로 확인한다
// 바깥을 스치듯 눌러 닫히지 않게 한다(dismissible=false) — 닫기는 [닫기]와 [취소]로
function ScoreForm({
  match,
  busy,
  notice,
  onSubmit,
  onCancel,
}: {
  match: ITournamentMatch;
  busy: boolean;
  notice: React.ReactNode;
  onSubmit: (blueScore: number, whiteScore: number) => void;
  onCancel: () => void;
}) {
  const scored = match.blueScore !== null && match.whiteScore !== null;
  const [winner, setWinner] = useState<TournamentTeam | null>(
    scored ? (match.blueScore === TOURNAMENT_WIN_SCORE ? TournamentTeam.BLUE : TournamentTeam.WHITE) : null,
  );
  const [loser, setLoser] = useState(
    scored ? String(match.blueScore === TOURNAMENT_WIN_SCORE ? match.whiteScore : match.blueScore) : '',
  );
  const loserScore = loser === '' ? NaN : Number(loser);
  const valid = winner !== null && Number.isInteger(loserScore) && loserScore >= 0 && loserScore < TOURNAMENT_WIN_SCORE;
  // 저장 버튼이 흐려져 있는 이유 — 아직 아무것도 하지 않았을 때는 재촉하지 않는다
  const reason =
    loser !== '' && loserScore >= TOURNAMENT_WIN_SCORE
      ? `진 팀 점수는 0부터 ${TOURNAMENT_WIN_SCORE - 1}까지예요`
      : winner === null && loser !== ''
        ? '이긴 팀을 골라 주세요'
        : winner !== null && loser === ''
          ? '진 팀 점수를 적어 주세요'
          : null;
  const loserLabel = winner === null ? '진 팀 점수' : `${winner === TournamentTeam.BLUE ? '백팀' : '청팀'} 점수 (진 팀)`;
  const submit = () => {
    if (busy || !valid) return;
    if (winner === TournamentTeam.BLUE) onSubmit(TOURNAMENT_WIN_SCORE, loserScore);
    else onSubmit(loserScore, TOURNAMENT_WIN_SCORE);
  };
  const teamBtn = (team: TournamentTeam, label: string, names: string[]) => (
    <button
      onClick={() => setWinner(team)}
      className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 transition-colors ${
        winner === team ? 'border-court bg-court/15' : 'border-line'
      }`}
    >
      <span className={`text-body font-bold ${winner === team ? 'text-court' : 'text-dim'}`}>{label}</span>
      <span className={`text-sm font-bold ${team === TournamentTeam.BLUE ? 'text-sky' : 'text-ink'}`}>{names.join(', ')}</span>
    </button>
  );

  return (
    <Sheet
      ariaLabel="점수 입력"
      dismissible={false}
      onClose={onCancel}
      header={
        <div className="min-w-0">
          <h2 className="text-body font-bold">{scored ? '점수 고치기' : '점수 입력'}</h2>
          <p className="text-caption text-dim">
            {match.matchNo}번, {match.round}라운드, {match.courtNo}코트, {TOURNAMENT_TYPE_LABEL[match.type]}
          </p>
        </div>
      }
      footer={
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy || !valid} className="h-12 flex-1 rounded-xl bg-court text-body font-bold text-bg transition-opacity disabled:opacity-40">
            {scored ? '점수 고치기' : '점수 저장'}
          </button>
          <button onClick={onCancel} className="h-12 rounded-xl border border-line px-5 text-sm font-bold text-dim">
            취소
          </button>
        </div>
      }
    >
      {notice}
      <p className="text-sm text-dim">
        이긴 팀은 <span className="font-bold text-ink">{TOURNAMENT_WIN_SCORE}점</span>으로 저장돼요. 이긴 팀을 고르고 진 팀 점수만 적어 주세요.
      </p>
      <div className="flex gap-2">
        {teamBtn(TournamentTeam.BLUE, '청팀 승', tournamentBlueNames(match))}
        {teamBtn(TournamentTeam.WHITE, '백팀 승', tournamentWhiteNames(match))}
      </div>
      <label htmlFor="tournament-loser-score" className="text-sm font-bold text-dim">
        {loserLabel}
      </label>
      <div className="-mt-1 flex items-center gap-3">
        <input
          id="tournament-loser-score"
          value={loser}
          onChange={(e) => setLoser(e.target.value.replace(/\D/g, '').slice(0, 2))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          inputMode="numeric"
          placeholder="0~20"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-panel2 px-4 text-body outline-none focus:border-court"
        />
        <span className="shrink-0 text-body font-bold tabular-nums text-dim">
          {winner === null || !valid
            ? '청 - : - 백'
            : winner === TournamentTeam.BLUE
              ? `청 ${TOURNAMENT_WIN_SCORE} : ${loserScore} 백`
              : `청 ${loserScore} : ${TOURNAMENT_WIN_SCORE} 백`}
        </span>
      </div>
      {reason && <p className="text-sm text-amber">{reason}</p>}
    </Sheet>
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
        <span className="font-bold text-sky">{tournamentBlueNames(match).join(', ')}</span>
        <span className="mx-1.5 text-caption text-faint">vs</span>
        <span className="font-bold">{tournamentWhiteNames(match).join(', ')}</span>
      </p>
    </div>
  );
}
