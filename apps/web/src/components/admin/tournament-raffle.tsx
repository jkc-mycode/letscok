'use client';

import { ITournamentDetail, ITournamentPrize, TOURNAMENT_PRIZE_NAME_MAX } from '@letscok/shared-types';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { api, ApiError } from '@/lib/api';

// 추첨 — 상품을 미리 등록해 두고, 현장에서 뽑힌 추첨 번호를 적으면 그 번호를 받은 사람이 당첨자로 남는다
// 추첨 번호는 입구 체크인 때 순서대로 매겨진다(체크인 탭에서 고친다). 운영진만 본다

const BTN = 'h-9 shrink-0 rounded-lg px-3 text-sm font-bold transition-opacity disabled:opacity-40';

export function TournamentRaffle({ detail, onChange }: { detail: ITournamentDetail; onChange: (next: ITournamentDetail) => void }) {
  const { tournament, participants, prizes } = detail;
  const [names, setNames] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // 상품 id → 적는 중인 당첨 번호
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const base = `/tournaments/${tournament.id}/prizes`;

  const holderOf = (raffleNo: number) => participants.find((p) => p.raffleNo === raffleNo) ?? null;
  const drawn = prizes.filter((prize) => prize.participantId !== null);
  const winCount = (participantId: string) => drawn.filter((prize) => prize.participantId === participantId).length;
  const issued = participants.filter((p) => p.raffleNo !== null).length;

  const run = async (request: () => Promise<ITournamentDetail>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await request());
      after?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const addPrizes = () => {
    const list = names.split('\n').map((name) => name.trim()).filter(Boolean);
    const long = list.find((name) => name.length > TOURNAMENT_PRIZE_NAME_MAX);
    if (long) {
      setError(`상품 이름은 ${TOURNAMENT_PRIZE_NAME_MAX}자까지예요: ${long}`);
      return;
    }
    void run(() => api<ITournamentDetail>(base, { method: 'POST', admin: true, body: { names: list } }), () => setNames(''));
  };
  const setWinner = (prize: ITournamentPrize, raffleNo: number) =>
    run(
      () => api<ITournamentDetail>(`${base}/${prize.id}/winner`, { method: 'PUT', admin: true, body: { raffleNo } }),
      () => setDrafts((prev) => ({ ...prev, [prize.id]: '' })),
    );
  const clearWinner = (prize: ITournamentPrize) => run(() => api<ITournamentDetail>(`${base}/${prize.id}/winner`, { method: 'DELETE', admin: true }));
  const removePrize = (prize: ITournamentPrize) => run(() => api<ITournamentDetail>(`${base}/${prize.id}`, { method: 'DELETE', admin: true }));
  // 시트나 단체 대화방에 붙여 넣을 글 — 결과를 내리면 이 화면에서 다시 볼 수 없어 남겨 둘 수 있게
  const copy = async () => {
    const text = prizes
      .map((prize) => [prize.name, prize.raffleNo === null ? '' : `${prize.raffleNo}번`, prize.winnerName ?? ''].join('\t'))
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('복사하지 못했어요. 브라우저의 복사 권한을 확인해 주세요.');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2 rounded-2xl bg-panel p-5">
        <span className="text-display font-bold tabular-nums text-court">{drawn.length}</span>
        <span className="text-body text-dim">/ {prizes.length}개 당첨 기록</span>
        <span className="text-caption text-faint">추첨권 {issued}장 나감</span>
        {prizes.length > 0 && (
          <button onClick={() => void copy()} className={`${BTN} ml-auto border border-line text-dim`}>
            {copied ? '복사했어요' : '결과 복사'}
          </button>
        )}
      </div>
      {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      {prizes.length === 0 && <p className="py-4 text-center text-sm text-faint">등록한 상품이 없어요. 아래에서 상품을 등록해 주세요.</p>}
      <ul className="flex flex-col gap-2">
        {prizes.map((prize, index) => {
          const draft = drafts[prize.id] ?? '';
          const draftNo = /^\d+$/.test(draft) ? Number(draft) : null;
          const holder = draftNo === null ? null : holderOf(draftNo);
          const won = prize.participantId !== null;
          return (
            <li key={prize.id} className={`flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 ${won ? 'bg-court/10' : 'bg-panel'}`}>
              <span className="w-6 shrink-0 text-center text-sm tabular-nums text-dim">{index + 1}</span>
              <span className="min-w-0 flex-1 text-body font-bold">{prize.name}</span>
              {won ? (
                <>
                  <span className="text-body font-bold text-court">
                    {prize.raffleNo}번 {prize.winnerName}
                  </span>
                  {winCount(prize.participantId!) > 1 && <span className="text-caption font-bold text-amber">중복 당첨</span>}
                  <ConfirmButton
                    label="당첨 지우기"
                    confirmLabel="한 번 더"
                    className={BTN}
                    idleCls="border border-line text-dim"
                    disabled={busy}
                    onConfirm={() => void clearWinner(prize)}
                  />
                </>
              ) : (
                <>
                  {draftNo !== null && (
                    <span className={`text-sm ${holder ? 'text-dim' : 'text-coral'}`}>{holder ? holder.name : '그 번호를 받은 사람이 없어요'}</span>
                  )}
                  <input
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [prize.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && holder && !busy) void setWinner(prize, draftNo!);
                    }}
                    inputMode="numeric"
                    placeholder="당첨 번호"
                    aria-label={`${prize.name} 당첨 번호`}
                    className="h-9 w-24 rounded-lg border border-line bg-panel2 px-3 text-body tabular-nums outline-none focus:border-court"
                  />
                  <button onClick={() => void setWinner(prize, draftNo!)} disabled={busy || !holder} className={`${BTN} bg-court text-bg`}>
                    당첨 기록
                  </button>
                  <ConfirmButton
                    label="빼기"
                    confirmLabel="한 번 더"
                    className={BTN}
                    idleCls="border border-line text-dim"
                    disabled={busy}
                    onConfirm={() => void removePrize(prize)}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 rounded-2xl bg-panel p-4">
        <h2 className="text-body font-bold">상품 등록</h2>
        <p className="text-caption text-dim">한 줄에 상품 하나씩 적어 주세요. 같은 상품이 여러 개면 그 수만큼 줄을 적어요.</p>
        <textarea
          value={names}
          onChange={(e) => setNames(e.target.value)}
          rows={4}
          placeholder={'라켓\n셔틀콕 한 통\n셔틀콕 한 통'}
          className="rounded-lg border border-line bg-panel2 px-3 py-2 text-body outline-none focus:border-court"
        />
        <button onClick={addPrizes} disabled={busy || names.trim() === ''} className={`${BTN} self-start bg-court text-bg`}>
          등록
        </button>
      </div>
    </section>
  );
}
