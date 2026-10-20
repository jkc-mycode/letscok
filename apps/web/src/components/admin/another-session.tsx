'use client';

import { IClosedTodaySession, IClosedTodayResponse, IOpenSessionBrief, ISession } from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api } from '@/lib/api';

// 모임 하나 더 열기 — 여복·남복처럼 같은 체육관에서 코트를 나눠 동시에 운영한다
// 두 모임을 칩으로 구분해야 하니 이름이 필수. 이름 없이 먼저 연 모임이 있으면 여기서 같이 정한다(관제판 첫 화면·더보기 공용)
// 오늘 끝낸 모임이 있으면 아래에 [다시 열기] — 여복·남복 중 한쪽만 실수로 끝냈을 때 되살린다

const SUGGESTIONS = ['여복', '남복', '혼복'];
const MAX_LABEL = 10; // 서버와 같은 길이 제한

export function AnotherSessionSheet({
  unnamed,
  openSessions,
  run,
  onOpened,
  onClose,
}: {
  unnamed?: IOpenSessionBrief; // 이름 없이 열려 있는 모임 — 보통 먼저 연 쪽
  openSessions: IOpenSessionBrief[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  onOpened: (sessionId: string) => Promise<void>; // 새 모임으로 화면을 바꾼다(코트부터 등록하게)
  onClose: () => void;
}) {
  const needsCurrent = unnamed !== undefined;
  const [currentLabel, setCurrentLabel] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const used = [...openSessions.map((s) => s.label), needsCurrent ? currentLabel.trim() : null].filter(Boolean);
  const name = newLabel.trim();
  const currentReady = !needsCurrent || currentLabel.trim() !== '';
  const nameReady = name !== '' && !used.includes(name);
  const ready = nameReady && currentReady;
  const [closed, setClosed] = useState<IClosedTodaySession[]>([]);
  useEffect(() => {
    api<IClosedTodayResponse>('/sessions/closed-today', { admin: true })
      .then((r) => setClosed(r.sessions ?? [])) // 배포 사이 옛 서버는 목록 없이 답한다
      .catch(() => undefined); // 못 받아도 새 모임은 열 수 있다
  }, []);

  // body: 새 모임이면 { label }, 되살리기면 { resumeId, label? }
  const openWith = (body: { label?: string; resumeId?: string }) => {
    onClose();
    void run(async () => {
      if (needsCurrent) {
        await api(`/sessions/${unnamed.id}/label`, { method: 'PATCH', admin: true, body: { label: currentLabel.trim() } });
      }
      const opened = await api<ISession>('/sessions', { method: 'POST', admin: true, body });
      await onOpened(opened.id);
    });
  };
  const submit = () => {
    if (ready) openWith({ label: name });
  };
  // 끝낸 모임은 원래 이름으로 — 이름이 없거나 열린 모임과 겹치면 '새 모임 이름' 칸의 이름으로 연다
  const resumeLabel = (c: IClosedTodaySession) => {
    if (c.session.label && !used.includes(c.session.label)) return { ok: true, label: undefined };
    return { ok: nameReady, label: name };
  };

  return (
    <Sheet
      ariaLabel="모임 하나 더 열기"
      onClose={onClose}
      dismissible={false}
      header={<h2 className="text-heading font-bold">모임 하나 더 열기</h2>}
      footer={
        <button
          onClick={submit}
          disabled={!ready}
          className="h-13 w-full rounded-2xl bg-court text-body font-bold text-bg disabled:opacity-50"
        >
          {name ? `'${name}' 모임 열기` : '모임 열기'}
        </button>
      }
    >
      <p className="text-body-sm text-dim">
        같은 체육관에서 코트를 나눠 따로 운영해요. 출석·대기·게임은 모임마다 따로이고, 입장 코드는 같아요. 위쪽 칩으로 오갈 수 있어요.
      </p>
      {needsCurrent && (
        <LabelField label="먼저 연 모임 이름" value={currentLabel} onChange={setCurrentLabel} taken={[name]} />
      )}
      <LabelField label="새 모임 이름" value={newLabel} onChange={setNewLabel} taken={used as string[]} />
      {name !== '' && used.includes(name) && <p className="text-body-sm text-coral">이미 쓰는 이름이에요</p>}
      {closed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-bold text-dim">오늘 끝낸 모임 다시 열기</p>
          {closed.map((c) => {
            const { ok, label } = resumeLabel(c);
            const shown = label ?? c.session.label;
            return (
              <button
                key={c.session.id}
                onClick={() => openWith({ resumeId: c.session.id, ...(label && { label }) })}
                disabled={!ok || !currentReady}
                className="tap flex flex-col items-start gap-1 rounded-2xl bg-panel2 px-4 py-3 text-left disabled:opacity-50"
              >
                <span className="text-body font-bold">{shown ? `'${shown}'(으)로 다시 열기` : '다시 열기'}</span>
                <span className="text-body-sm text-dim">
                  {c.session.label ?? '이름 없는 모임'} · {closedRange(c.session)} · {c.attendeeCount}명 출석
                  {!ok && ' — 위 새 모임 이름 칸에 이름을 정해 주세요'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

// 이름 칸 + 자주 쓰는 이름 칩(다른 칸에서 고른 이름은 뺀다)
function LabelField({
  label,
  value,
  onChange,
  taken,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  taken: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm font-bold text-dim">{label}</p>
      <input
        autoComplete="off"
        enterKeyHint="done"
        maxLength={MAX_LABEL}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: 여복"
        className="h-11 rounded-xl border-2 border-transparent bg-panel2 px-4 text-body outline-none focus:border-court"
      />
      <div className="flex gap-1.5">
        {SUGGESTIONS.filter((s) => !taken.includes(s)).map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`h-9 rounded-full px-4 text-body-sm font-bold ${value === s ? 'bg-court text-bg' : 'bg-panel2 text-dim'}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// "14:30~16:10" — 끝낸 모임 고르는 창의 모임 시간(관제판 첫 화면과 공용)
export function closedRange(session: ISession): string {
  return `${clock(session.openedAt)}~${session.closedAt ? clock(session.closedAt) : ''}`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}
