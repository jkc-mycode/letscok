'use client';

import { ICourt, IGame } from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Sheet } from '@/components/sheet';
import { api } from '@/lib/api';
import { useOptimisticMap } from '@/lib/use-optimistic-map';

// 코트 관리(추가·공유·번호 바꾸기·해제)와 코트 고르기 시트(배정·옮기기)

export function CourtsManager({
  sessionId,
  courts,
  playingByCourt,
  runParallel,
  onClose,
}: {
  sessionId: string;
  courts: ICourt[];
  playingByCourt: Map<string, IGame>;
  runParallel: (a: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [courtNo, setCourtNo] = useState('');
  // 누르자마자 반영 — 서버 응답·화면 새로고침(두 번 오감)을 기다리면 느리고, 공통 잠금 때문에 다른 버튼도 막혔다.
  // 서버 화면에 실리면 표시를 지우고, 실패하면 되돌린다(알림은 runParallel)
  const [sharedOverride, sharedOpt] = useOptimisticMap<boolean>(
    (id, v) => courts.some((c) => c.id === id && c.isShared !== v),
    courts,
  );
  const [removing, removingOpt] = useOptimisticMap<true>((id) => courts.some((c) => c.id === id), courts);
  const [adding, setAdding] = useState<number[]>([]);
  const [numberOverride, numberOpt] = useOptimisticMap<number>( // 번호 바꾸는 중
    (id, no) => courts.some((c) => c.id === id && c.courtNo !== no),
    courts,
  );
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null); // 번호를 눌러 고치는 줄
  useEffect(() => {
    setAdding((prev) => {
      const next = prev.filter((no) => !courts.some((c) => c.courtNo === no));
      return next.length === prev.length ? prev : next;
    });
  }, [courts]);
  const view = courts
    .filter((c) => !removing.has(c.id))
    .map((c) => (sharedOverride.has(c.id) ? { ...c, isShared: sharedOverride.get(c.id)! } : c))
    .map((c) => (numberOverride.has(c.id) ? { ...c, courtNo: numberOverride.get(c.id)! } : c));

  const add = () => {
    const no = Number(courtNo);
    if (!no || adding.includes(no)) return;
    setCourtNo('');
    setAdding((prev) => [...prev, no]);
    void runParallel(() => api(`/sessions/${sessionId}/courts`, { method: 'POST', admin: true, body: { courtNo: no } })).then(
      (ok) => !ok && setAdding((prev) => prev.filter((n) => n !== no)),
    );
  };
  const toggleShared = (court: ICourt) => {
    const isShared = !court.isShared;
    sharedOpt.set(court.id, isShared);
    void runParallel(() => api(`/courts/${court.id}/shared`, { method: 'PATCH', admin: true, body: { isShared } })).then(
      (ok) => !ok && sharedOpt.remove(court.id),
    );
  };
  // 잘못 등록한 번호 고치기 — 다른 코트가 쓰는 번호면 서버가 막고 이유를 알려 준다
  const renumber = (court: ICourt, value: string) => {
    setEditing(null);
    const no = Number(value);
    if (!no || no === court.courtNo) return;
    numberOpt.set(court.id, no);
    void runParallel(() => api(`/courts/${court.id}`, { method: 'PATCH', admin: true, body: { courtNo: no } })).then(
      (ok) => !ok && numberOpt.remove(court.id),
    );
  };
  const remove = (court: ICourt) => {
    removingOpt.set(court.id, true);
    void runParallel(() => api(`/courts/${court.id}`, { method: 'DELETE', admin: true })).then(
      (ok) => !ok && removingOpt.remove(court.id),
    );
  };

  return (
    <Sheet
      ariaLabel="코트 관리"
      onClose={onClose}
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">코트 관리</h2>}
      footer={
        <div className="flex gap-2">
          <input
            autoComplete="off"
            inputMode="numeric"
            enterKeyHint="done"
            value={courtNo}
            onChange={(e) => setCourtNo(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="코트 번호"
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
          />
          <button onClick={add} disabled={!courtNo} className="h-11 rounded-xl bg-court px-5 text-sm font-bold text-bg disabled:opacity-50">
            추가
          </button>
        </div>
      }
    >
      {view.length === 0 && adding.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">오늘 쓰는 코트 번호를 아래에서 추가해주세요</p>
      )}
      {view.length > 0 && <p className="text-xs text-faint">번호를 누르면 바꿀 수 있어요(게임 중에도 돼요)</p>}
      {view.map((court) => {
        const inGame = playingByCourt.has(court.id);
        if (editing?.id === court.id) {
          return (
            <div key={court.id} className="flex items-center gap-2 rounded-xl bg-panel2 p-3">
              <input
                autoFocus
                autoComplete="off"
                inputMode="numeric"
                enterKeyHint="done"
                value={editing.value}
                onChange={(e) => setEditing({ id: court.id, value: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                onKeyDown={(e) => e.key === 'Enter' && renumber(court, editing.value)}
                aria-label={`${court.courtNo}번 코트 새 번호`}
                className="h-9 w-16 rounded-lg border-2 border-court bg-panel px-2 text-center font-bold outline-none"
              />
              <span className="font-bold">번 코트로</span>
              <button
                onClick={() => renumber(court, editing.value)}
                disabled={!editing.value}
                className="ml-auto h-9 rounded-lg bg-court px-3 text-xs font-bold text-bg disabled:opacity-50"
              >
                바꾸기
              </button>
              <button onClick={() => setEditing(null)} className="h-9 rounded-lg px-3 text-xs text-dim">
                취소
              </button>
            </div>
          );
        }
        return (
          <div
            key={court.id}
            className="flex items-center gap-2 rounded-xl bg-panel2 p-3"
          >
            <button
              onClick={() => setEditing({ id: court.id, value: String(court.courtNo) })}
              disabled={numberOverride.has(court.id)}
              title="번호 바꾸기"
              className="tap font-bold underline decoration-dotted underline-offset-4 disabled:opacity-60"
            >
              {court.courtNo}번 코트
            </button>
            {inGame && <span className="text-xs text-coral">게임 중</span>}
            {/* 공유 토글 — 다른 모임과 콕 걸고 번갈아 쓰는 코트. 게임 중에도 전환 가능(치는 도중 공유가 시작되기도) */}
            <button
              onClick={() => toggleShared(court)}
              title="다른 모임과 번갈아 쓰는 코트 지정/해제"
              className={`ml-auto h-9 rounded-lg border px-3 text-xs font-medium ${
                court.isShared ? 'border-sky/50 bg-sky/15 text-sky' : 'border-line text-dim'
              }`}
            >
              {court.isShared ? '공유 중' : '공유'}
            </button>
            {/* 게임 중엔 못 누르고, 비어 있으면 두 번 눌러야 해제(3초 안에 다시 누르기) */}
            {inGame ? (
              <button
                disabled
                title="게임 진행 중"
                className="h-9 rounded-lg bg-panel2 px-3 text-xs text-dim disabled:opacity-30"
              >
                해제
              </button>
            ) : (
              <ConfirmButton
                label="해제"
                title="코트 해제"
                onConfirm={() => remove(court)}
                className="h-9 rounded-lg px-3 text-xs"
                idleCls="bg-panel2 text-dim"
              />
            )}
          </div>
        );
      })}
      {/* 추가 중 — 서버 응답 전에도 바로 보이게(응답이 오면 진짜 코트 줄로 바뀐다) */}
      {adding
        .filter((no) => !courts.some((c) => c.courtNo === no))
        .map((no) => (
          <div key={`adding-${no}`} className="flex items-center gap-2 rounded-xl bg-panel2 p-3 opacity-70">
            <span className="font-bold">{no}번 코트</span>
            <span className="ml-auto text-xs text-dim">추가하는 중…</span>
          </div>
        ))}
    </Sheet>
  );
}

// 코트 고르기 — 빈 코트가 둘 이상일 때 [코트 배정]에서 열린다. 상대 차례인 공유 코트는 이유와 함께 비활성
export function CourtPickSheet({
  game,
  idleCourts,
  title = '몇 번 코트에 넣을까요?',
  onAssign,
  onClose,
}: {
  game: IGame;
  idleCourts: ICourt[];
  title?: string; // 게임 중 조합 옮기기에서도 쓴다
  onAssign: (gameId: string, courtId: string) => void;
  onClose: () => void;
}) {
  const names = (game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean);
  return (
    <Sheet
      ariaLabel="코트 고르기"
      onClose={onClose}
      header={<h2 className="min-w-0 truncate text-lg font-bold text-amber">{title}</h2>}
    >
      <p className="text-sm text-dim">{names.join(', ')}</p>
      {idleCourts.length === 0 && <p className="py-4 text-center text-sm text-faint">빈 코트가 없어요</p>}
      <div className="grid grid-cols-2 gap-2">
        {idleCourts.map((court) => {
          const theirTurn = court.isShared && !court.ourTurn;
          return (
            <button
              key={court.id}
              onClick={() => {
                onAssign(game.id, court.id);
                onClose();
              }}
              disabled={theirTurn}
              className="flex h-16 flex-col items-center justify-center rounded-xl bg-amber text-lg font-bold text-bg disabled:bg-panel2 disabled:text-faint"
            >
              {court.courtNo}번 코트
              {theirTurn && <span className="text-caption font-medium">다른 모임 차례</span>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
