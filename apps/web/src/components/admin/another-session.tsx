'use client';

import { IOpenSessionBrief, ISession } from '@letscok/shared-types';
import { useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api } from '@/lib/api';

// 모임 하나 더 열기 — 여복·남복처럼 같은 체육관에서 코트를 나눠 동시에 운영한다
// 두 모임을 칩으로 구분해야 하니 이름이 필수. 지금 모임에 이름이 없으면 여기서 같이 정한다

const SUGGESTIONS = ['여복', '남복', '혼복'];
const MAX_LABEL = 10; // 서버와 같은 길이 제한

export function AnotherSessionSheet({
  current,
  openSessions,
  run,
  onOpened,
  onClose,
}: {
  current: ISession;
  openSessions: IOpenSessionBrief[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  onOpened: (sessionId: string) => Promise<void>; // 새 모임으로 화면을 바꾼다(코트부터 등록하게)
  onClose: () => void;
}) {
  const needsCurrent = !current.label;
  const [currentLabel, setCurrentLabel] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const used = [...openSessions.map((s) => s.label), needsCurrent ? currentLabel.trim() : null].filter(Boolean);
  const name = newLabel.trim();
  const ready = name !== '' && !used.includes(name) && (!needsCurrent || currentLabel.trim() !== '');

  const submit = () => {
    if (!ready) return;
    onClose();
    void run(async () => {
      if (needsCurrent) {
        await api(`/sessions/${current.id}/label`, { method: 'PATCH', admin: true, body: { label: currentLabel.trim() } });
      }
      const opened = await api<ISession>('/sessions', { method: 'POST', admin: true, body: { label: name } });
      await onOpened(opened.id);
    });
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
        <LabelField label="지금 모임 이름" value={currentLabel} onChange={setCurrentLabel} taken={[name]} />
      )}
      <LabelField label="새 모임 이름" value={newLabel} onChange={setNewLabel} taken={used as string[]} />
      {name !== '' && used.includes(name) && <p className="text-body-sm text-coral">이미 쓰는 이름이에요</p>}
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
