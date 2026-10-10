'use client';

import { IEntryFee, IUpdateEntryFeeDto } from '@letscok/shared-types';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api, ApiError } from '@/lib/api';

// 오늘의 입장비 — 한 사람이 체육관에 몰아서 내고 나머지가 계좌로 보낸다. 운영진이 입금 내역을 보고 체크한다
// 금액·받는 사람·계좌는 [저장]으로, 체크는 누르자마자 저장한다(서버 응답을 기다리지 않고 바로 보여 줌)

const digitsOnly = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7); // 100만 원 미만
const withCommas = (v: string) => (v ? Number(v).toLocaleString('ko-KR') : '');
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const monthDay = (date: string) => {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일`;
};

type Form = { feeText: string; payeeId: string; account: string };
const toForm = (data: IEntryFee): Form => ({
  feeText: data.fee === null ? '' : String(data.fee),
  payeeId: data.payeeAttendanceId ?? '',
  account: data.account ?? '',
});

export function EntryFeeSheet({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<IEntryFee | null>(null);
  const [form, setForm] = useState<Form>({ feeText: '', payeeId: '', account: '' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 누른 체크 — 서버 응답이 같은 값으로 오면 지운다(실패하면 되돌림)
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    let alive = true;
    api<IEntryFee>(`/sessions/${sessionId}/entry-fee`, { admin: true })
      .then((result) => {
        if (!alive) return;
        setData(result);
        setForm(toForm(result));
      })
      .catch((e) => alive && setLoadError(e instanceof ApiError ? e.message : '입장비를 불러오지 못했어요.'));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const saved = data ? toForm(data) : null;
  const dirty =
    saved !== null &&
    (saved.feeText !== form.feeText || saved.payeeId !== form.payeeId || saved.account.trim() !== form.account.trim());

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: IUpdateEntryFeeDto = {
        fee: form.feeText ? Number(form.feeText) : null,
        payeeAttendanceId: form.payeeId || null,
        account: form.account.trim() || null,
      };
      const result = await api<IEntryFee>(`/sessions/${sessionId}/entry-fee`, { method: 'PUT', admin: true, body });
      setData(result);
      setForm(toForm(result));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  // 지난번 값 — 금액·계좌, 받는 사람은 오늘도 왔으면 그 사람으로
  const loadPrevious = () => {
    const prev = data?.previous;
    if (!prev) return;
    const payee = prev.payeeMemberId ? data.rows.find((r) => r.memberId === prev.payeeMemberId) : undefined;
    setForm((f) => ({
      feeText: prev.fee === null ? f.feeText : String(prev.fee),
      account: prev.account,
      payeeId: payee?.attendanceId ?? f.payeeId,
    }));
  };

  const togglePaid = (attendanceId: string, paid: boolean) => {
    setPending((prev) => new Map(prev).set(attendanceId, paid));
    setError(null);
    api<IEntryFee>(`/attendances/${attendanceId}/entry-paid`, { method: 'PATCH', admin: true, body: { paid } })
      .then((result) => {
        // 금액·계좌를 고치는 중일 수 있어 입력칸은 건드리지 않고 목록만 바꾼다
        setData((prev) => (prev ? { ...prev, rows: result.rows } : result));
        setPending((prev) => {
          if (prev.get(attendanceId) !== paid) return prev; // 그사이 또 눌렀으면 마지막 것을 기다린다
          const next = new Map(prev);
          next.delete(attendanceId);
          return next;
        });
      })
      .catch((e) => {
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(attendanceId);
          return next;
        });
        setError(e instanceof ApiError ? e.message : '체크를 저장하지 못했어요.');
      });
  };

  const rows = (data?.rows ?? []).map((r) => {
    // 받는 사람은 고르는 즉시(저장 전에도) 낸 사람으로 보여 준다
    const isPayee = form.payeeId ? r.attendanceId === form.payeeId : r.isPayee;
    const paid = isPayee || (pending.get(r.attendanceId) ?? (r.isPayee ? r.paidAt !== null : r.paid));
    return { ...r, isPayee, paid };
  });
  const paidCount = rows.filter((r) => r.paid).length;
  const unpaid = rows.filter((r) => !r.paid);
  const fee = form.feeText ? Number(form.feeText) : null;
  const account = form.account.trim();
  const payeeName = rows.find((r) => r.isPayee)?.name;
  const ready = fee !== null && account !== '';
  const when = data ? monthDay(data.date) : '';

  const guideText = ready
    ? [`🏸 ${when} 입장비 안내`, `1인 ${won(fee)}`, account, payeeName ? `(${payeeName}님이 먼저 냈어요)` : '', '입금 부탁드려요 🙏']
        .filter(Boolean)
        .join('\n')
    : '';
  const remindText = ready
    ? [
        `🏸 ${when} 입장비 아직 확인이 안 된 분`,
        `${unpaid.map((r) => r.name).join(', ')} (${unpaid.length}명)`,
        `1인 ${won(fee)} · ${account}`,
        '이미 보내셨다면 말씀해 주세요 🙏',
      ].join('\n')
    : '';

  return (
    // 금액·계좌를 적는 중일 수 있어 바깥 배경 탭으로는 닫지 않는다
    <Sheet
      ariaLabel="입장비"
      dismissible={false}
      onClose={onClose}
      header={
        <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">
          입장비 {data && <span className="text-body-sm font-medium text-dim">{when}</span>}
        </h2>
      }
    >
      {loadError && <p className="py-8 text-center text-body-sm text-coral">{loadError}</p>}
      {!data && !loadError && <p className="py-8 text-center text-body-sm text-dim">불러오는 중...</p>}
      {data && (
        <>
          <section className="flex flex-col gap-2.5 rounded-xl bg-panel2 p-3">
            <label className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-body-sm text-dim">1인 금액</span>
              <input
                value={withCommas(form.feeText)}
                onChange={(e) => setForm((f) => ({ ...f, feeText: digitsOnly(e.target.value) }))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                className="tabular h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-panel px-3 text-right text-base outline-none placeholder:text-faint focus:border-court"
              />
              <span className="text-body-sm text-dim">원</span>
            </label>
            <label className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-body-sm text-dim">받는 사람</span>
              <select
                value={form.payeeId}
                onChange={(e) => setForm((f) => ({ ...f, payeeId: e.target.value }))}
                className="h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-panel px-3 text-base outline-none focus:border-court"
              >
                <option value="">고르지 않음</option>
                {data.rows.map((r) => (
                  <option key={r.attendanceId} value={r.attendanceId}>
                    {r.name}
                    {r.isGuest ? ' (게스트)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-body-sm text-dim">계좌</span>
              <input
                value={form.account}
                onChange={(e) => setForm((f) => ({ ...f, account: e.target.value.slice(0, 60) }))}
                autoComplete="off"
                placeholder="국민 123-456-789 홍길동"
                className="h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-panel px-3 text-base outline-none placeholder:text-faint focus:border-court"
              />
            </label>
            <div className="flex gap-2">
              {data.previous && (
                <button
                  onClick={loadPrevious}
                  title={`${data.previous.account}${data.previous.payeeName ? ` · ${data.previous.payeeName}` : ''}`}
                  className="h-10 shrink-0 rounded-lg border border-line px-3 text-body-sm text-dim"
                >
                  지난번 값
                </button>
              )}
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="h-10 flex-1 rounded-lg bg-court text-body-sm font-bold text-bg disabled:bg-panel disabled:text-faint"
              >
                {saving ? '저장 중...' : dirty ? '저장' : '저장됨'}
              </button>
            </div>
          </section>

          {error && <p className="text-caption font-medium text-coral">{error}</p>}

          <div className="flex items-baseline gap-2">
            <h3 className="text-body font-bold">받았는지 체크</h3>
            <span className="tabular text-body-sm text-dim">
              {rows.length}명 중 <b className="text-court">{paidCount}명</b> 냄
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="py-4 text-center text-body-sm text-faint">아직 출석한 사람이 없어요</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {rows.map((r) => (
                <button
                  key={r.attendanceId}
                  onClick={() => !r.isPayee && togglePaid(r.attendanceId, !r.paid)}
                  disabled={r.isPayee}
                  aria-pressed={r.paid}
                  className={`flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-left text-body-sm ${
                    r.paid ? 'bg-court/12' : 'bg-panel2'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-caption font-bold ${
                      r.paid ? 'border-court bg-court text-bg' : 'border-line'
                    }`}
                    aria-hidden
                  >
                    {r.paid ? '✓' : ''}
                  </span>
                  <span className={`shrink-0 whitespace-nowrap ${r.paid ? 'font-medium' : ''}`}>{r.name}</span>
                  {r.isGuest && <span className="shrink-0 text-caption text-sky">게스트</span>}
                  {r.isPayee && (
                    <span className="ml-auto min-w-0 truncate rounded bg-amber/15 px-1.5 py-0.5 text-caption font-medium text-amber">
                      받는 사람
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            {!ready && <p className="text-caption text-faint">금액과 계좌를 적으면 카톡 문구를 복사할 수 있어요</p>}
            <div className="flex gap-2">
              <CopyButton label="안내 문구 복사" text={guideText} />
              <CopyButton label="미납 알림 복사" text={unpaid.length > 0 ? remindText : ''} />
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

// 카톡 문구 복사 — 자동 복사가 막힌 환경(권한·비보안 주소)에서는 상자를 띄워 길게 눌러 복사하게 한다
function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'done' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((s) => (s === 'done' ? null : s)), 2000);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <button
        onClick={() => void copy()}
        disabled={!text}
        className={`h-11 rounded-xl border text-body-sm font-bold disabled:border-line disabled:text-faint ${
          state === 'done' ? 'border-court bg-court/15 text-court' : 'border-court/50 text-court'
        }`}
      >
        {state === 'done' ? '복사했어요' : label}
      </button>
      {state === 'failed' && (
        <textarea
          readOnly
          value={text}
          rows={text.split('\n').length}
          onFocus={(e) => e.currentTarget.select()}
          className="resize-none rounded-lg bg-panel2 p-2 text-caption outline-none"
        />
      )}
    </div>
  );
}
