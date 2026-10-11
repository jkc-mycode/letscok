'use client';

import { IEntryFee, ISetEntryMembersDto, IUpdateEntryFeeDto } from '@letscok/shared-types';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api, ApiError } from '@/lib/api';

// 오늘의 입장비 — 한 사람이 체육관에 몰아서 내고 나머지가 계좌로 보낸다. 운영진이 입금 내역을 보고 체크한다
// 다 같이 한 사람에게 내는 게 아니라(각자 내는 사람도 있다) 출석자 중 [명단에서 고르기]로 넣은 사람만 목록에 든다
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
  const [removing, setRemoving] = useState<Set<string>>(new Set()); // ✕ 누른 사람 — 응답 전에도 목록에서 감춘다
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // 목록 넣기·빼기 — 입력칸은 건드리지 않고 목록만 바꾼다
  const setMembers = async (body: ISetEntryMembersDto) => {
    setError(null);
    try {
      const result = await api<IEntryFee>(`/sessions/${sessionId}/entry-fee/members`, {
        method: 'PATCH',
        admin: true,
        body,
      });
      setData((prev) => (prev ? { ...prev, rows: result.rows } : result));
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '목록을 바꾸지 못했어요.');
      return false;
    }
  };
  const removeMember = (attendanceId: string) => {
    setRemoving((prev) => new Set(prev).add(attendanceId));
    void setMembers({ attendanceIds: [attendanceId], included: false }).then(() =>
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(attendanceId);
        return next;
      }),
    );
  };

  const allRows = (data?.rows ?? []).map((r) => {
    // 받는 사람은 고르는 즉시(저장 전에도) 목록에 들고 낸 사람으로 보여 준다
    const isPayee = form.payeeId ? r.attendanceId === form.payeeId : r.isPayee;
    const paid = isPayee || (pending.get(r.attendanceId) ?? (r.isPayee ? r.paidAt !== null : r.paid));
    const included = isPayee || r.included; // 서버는 받는 사람으로 정한 사람을 목록에 넣어 둔다(바꿔도 남음)
    return { ...r, isPayee, paid, included };
  });
  const rows = allRows.filter((r) => r.included && !removing.has(r.attendanceId));
  const candidates = allRows.filter((r) => !r.included); // [명단에서 고르기] 후보
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
    // 고르기 시트는 시트 바깥에 둔다 — 시트는 움직이는(transform) 상자라 그 안의 fixed 요소는 위치가 깨진다
    <>
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

            <div className="flex items-center gap-2">
              <h3 className="text-body font-bold">받았는지 체크</h3>
              <span className="tabular text-body-sm text-dim">
                {rows.length}명 중 <b className="text-court">{paidCount}명</b> 냄
              </span>
              <button
                onClick={() => setPickerOpen(true)}
                disabled={candidates.length === 0}
                className="ml-auto h-9 shrink-0 rounded-lg border border-court/50 px-3 text-body-sm font-bold text-court disabled:border-line disabled:text-faint"
              >
                + 명단에서 고르기
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-body-sm text-faint">
                {allRows.length === 0 ? '아직 출석한 사람이 없어요' : '[명단에서 고르기]로 입장비를 보낼 사람을 넣어 주세요'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {rows.map((r) => (
                  <div
                    key={r.attendanceId}
                    className={`flex min-h-11 items-center rounded-[10px] ${r.paid ? 'bg-court/12' : 'bg-panel2'}`}
                  >
                    <button
                      onClick={() => !r.isPayee && togglePaid(r.attendanceId, !r.paid)}
                      disabled={r.isPayee}
                      aria-pressed={r.paid}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-body-sm"
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
                    {/* 받는 사람은 뺄 수 없다 — 받는 사람을 바꾸면 그때 뺄 수 있다 */}
                    {!r.isPayee && (
                      <button
                        onClick={() => removeMember(r.attendanceId)}
                        aria-label={`${r.name} 목록에서 빼기`}
                        className="tap h-11 w-10 shrink-0 text-xs text-faint hover:text-coral"
                      >
                        ✕
                      </button>
                    )}
                  </div>
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
      {pickerOpen && (
        <EntryMemberPicker
          candidates={candidates}
          onAdd={(ids) => setMembers({ attendanceIds: ids, included: true })}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

// 오늘 출석자 중 아직 목록에 없는 사람 — 여러 명 체크해서 한 번에 넣는다(늦게 온 사람도 같은 버튼으로)
function EntryMemberPicker({
  candidates,
  onAdd,
  onClose,
}: {
  candidates: { attendanceId: string; name: string; isGuest: boolean }[];
  onAdd: (attendanceIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const add = async () => {
    if (selected.size === 0 || adding) return;
    setAdding(true);
    const ok = await onAdd([...selected]);
    setAdding(false);
    if (ok) onClose();
  };
  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  return (
    <Sheet
      ariaLabel="입장비 목록에 넣기"
      layer="z-50"
      onClose={onClose}
      header={
        <>
          <h3 className="shrink-0 font-bold text-court">목록에 넣기</h3>
          <span className="text-caption text-faint">오늘 온 사람 중 아직 안 넣은 {candidates.length}명</span>
        </>
      }
      footer={
        <button
          onClick={() => void add()}
          disabled={selected.size === 0 || adding}
          className="h-12 w-full rounded-xl bg-court text-base font-bold text-bg disabled:bg-panel2 disabled:text-faint"
        >
          {adding ? '넣는 중...' : selected.size > 0 ? `${selected.size}명 넣기` : '사람을 골라주세요'}
        </button>
      }
    >
      <button
        onClick={() => setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.attendanceId)))}
        className="self-end text-caption font-medium text-dim"
      >
        {allSelected ? '전체 해제' : '전체 선택'}
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        {candidates.map((c) => {
          const on = selected.has(c.attendanceId);
          return (
            <button
              key={c.attendanceId}
              onClick={() => toggle(c.attendanceId)}
              aria-pressed={on}
              className={`flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-left text-body-sm ${
                on ? 'bg-court/12 font-medium' : 'bg-panel2'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-caption font-bold ${
                  on ? 'border-court bg-court text-bg' : 'border-line'
                }`}
                aria-hidden
              >
                {on ? '✓' : ''}
              </span>
              <span className="min-w-0 truncate">{c.name}</span>
              {c.isGuest && <span className="shrink-0 text-caption text-sky">G</span>}
            </button>
          );
        })}
      </div>
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
