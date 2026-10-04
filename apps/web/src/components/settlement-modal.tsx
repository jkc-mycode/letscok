'use client';

import { IAiCheckInStatus, IReceiptItem, IReceiptReadResult, ReceiptCategory } from '@letscok/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useBackClose } from '@/lib/back-stack';
import { shrinkImage } from '@/lib/image';
import { DEFAULT_GROUPS, settle, settlementText, won } from '@/lib/settlement';

// 뒤풀이 정산 — 인원수만 받고 저장하지 않는다(닫으면 사라짐). 결과는 카톡 문구로 복사해 공유한다

const digitsOnly = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9); // 9자리 = 9억 원 미만
const toNumber = (v: string) => (v ? Number(v) : 0);
const withCommas = (v: string) => (v ? Number(v).toLocaleString('ko-KR') : '');

function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-sm text-dim">{label}</span>
      <input
        value={withCommas(value)}
        onChange={(e) => onChange(digitsOnly(e.target.value))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        className="tabular h-11 min-w-0 flex-1 rounded-lg border border-line bg-panel2 px-3 text-right text-base outline-none placeholder:text-faint focus:border-court"
      />
      <span className="text-sm text-dim">원</span>
    </label>
  );
}

const MAX_RECEIPTS = 2; // 서버 한도 — 1차·2차 영수증

// 분류 칩 — 누를 때마다 공통 → 술 → 음료 순서로 바뀐다
const CATEGORY_LABEL: Record<ReceiptCategory, string> = { common: '공통', alcohol: '술', beverage: '음료' };
const CATEGORY_CLS: Record<ReceiptCategory, string> = {
  common: 'border-line text-dim',
  alcohol: 'border-amber/60 bg-amber/10 text-amber',
  beverage: 'border-sky/60 bg-sky/10 text-sky',
};
const NEXT_CATEGORY: Record<ReceiptCategory, ReceiptCategory> = {
  common: 'alcohol',
  alcohol: 'beverage',
  beverage: 'common',
};

const sumBy = (items: IReceiptItem[], category?: ReceiptCategory) =>
  items.filter((i) => !category || i.category === category).reduce((sum, i) => sum + i.amount, 0);

function Counter({ label, count, onChange }: { label: string; count: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm">{label}</span>
      <button
        onClick={() => onChange(Math.max(0, count - 1))}
        disabled={count === 0}
        className="h-10 w-10 rounded-lg border border-line text-lg text-dim disabled:opacity-40"
      >
        −
      </button>
      <input
        value={count === 0 ? '' : String(count)}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '').slice(0, 3) || 0))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        className="tabular h-10 w-12 rounded-lg border border-line bg-panel2 text-center text-base outline-none placeholder:text-faint focus:border-court"
      />
      <button onClick={() => onChange(count + 1)} className="h-10 w-10 rounded-lg border border-line text-lg text-dim">
        +
      </button>
    </div>
  );
}

export function SettlementModal({ onClose }: { onClose: () => void }) {
  useBackClose(onClose); // 안드로이드 뒤로가기 = 이 팝업 닫기
  const [total, setTotal] = useState('');
  const [alcohol, setAlcohol] = useState('');
  const [beverage, setBeverage] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [receipt, setReceipt] = useState<IReceiptReadResult | null>(null);
  const [reading, setReading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  // 서버에 AI 키가 없으면 영수증 버튼을 숨긴다 (AI 체크인과 같은 AiClient라 상태 API를 같이 쓴다)
  useEffect(() => {
    api<IAiCheckInStatus>('/ai-check-in/status', { admin: true })
      .then((status) => setAiEnabled(status.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // 영수증 분류 → 금액 칸. 총액은 영수증 결제 금액(못 읽었으면 품목 합계), 할인으로 음수가 되면 0
  const fillFromReceipt = (r: IReceiptReadResult) => {
    setTotal(String(Math.max(0, r.total ?? sumBy(r.items))));
    setAlcohol(String(Math.max(0, sumBy(r.items, 'alcohol'))));
    setBeverage(String(Math.max(0, sumBy(r.items, 'beverage'))));
  };

  const readReceipt = async (files: FileList | null) => {
    if (!files || files.length === 0 || reading) return;
    if (files.length > MAX_RECEIPTS) {
      setReceiptError(`영수증은 한 번에 ${MAX_RECEIPTS}장까지 올릴 수 있어요.`);
      return;
    }
    setReading(true);
    setReceiptError(null);
    try {
      const form = new FormData();
      for (const [i, file] of [...files].entries()) {
        form.append('images', await shrinkImage(file), `receipt-${i + 1}.jpg`);
      }
      const result = await api<IReceiptReadResult>('/settlement/receipt', { method: 'POST', admin: true, body: form });
      setReceipt(result);
      fillFromReceipt(result);
    } catch (e) {
      setReceiptError(e instanceof ApiError ? e.message : '영수증을 읽지 못했어요. 직접 입력해주세요.');
    } finally {
      setReading(false);
    }
  };

  // 칩을 바꾸면 금액 칸을 다시 채운다 — 직접 고친 금액은 덮어쓰므로 분류를 먼저 맞추고 칸을 고치는 순서
  const changeCategory = (index: number) => {
    if (!receipt) return;
    const items = receipt.items.map((item, i) =>
      i === index ? { ...item, category: NEXT_CATEGORY[item.category] } : item,
    );
    const next = { ...receipt, items };
    setReceipt(next);
    fillFromReceipt(next);
  };

  const itemsSum = receipt ? sumBy(receipt.items) : 0;

  const groups = useMemo(() => DEFAULT_GROUPS.map((g) => ({ ...g, count: counts[g.key] ?? 0 })), [counts]);
  const headcount = groups.reduce((sum, g) => sum + g.count, 0);
  const common = toNumber(total) - toNumber(alcohol) - toNumber(beverage);
  const result = useMemo(
    () => settle({ total: toNumber(total), alcohol: toNumber(alcohol), beverage: toNumber(beverage), groups }),
    [total, alcohol, beverage, groups],
  );
  const text = result.ok ? settlementText(toNumber(total), result.shares) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied('failed'); // 권한·비보안 환경 — 아래 상자에서 직접 길게 눌러 복사
    }
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied((c) => (c === 'done' ? null : c)), 2000);
  };

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-2 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-2xl border border-line bg-panel p-4 sm:p-5"
      >
        <div className="flex items-center pb-3">
          <h2 className="text-lg font-bold text-court">🍻 뒤풀이 정산</h2>
          <button
            onClick={onClose}
            className="ml-auto h-9 rounded-lg border border-line px-3 text-sm text-dim"
          >
            닫기
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 scroll-area">
          {/* 영수증으로 채우기 — AI가 품목을 공통·술·음료로 나누고, 칩을 눌러 고친다 */}
          {aiEnabled && (
            <div className="flex flex-col gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void readReceipt(e.target.files);
                  e.target.value = ''; // 같은 사진을 다시 골라도 onChange가 오게
                }}
              />
              <button
                onClick={() => fileInput.current?.click()}
                disabled={reading}
                className="h-11 rounded-xl border border-court/50 text-sm font-bold text-court disabled:opacity-50"
              >
                {reading ? '영수증을 읽는 중이에요…' : `📷 영수증으로 채우기 (최대 ${MAX_RECEIPTS}장)`}
              </button>
              {receiptError && <p className="text-xs font-medium text-coral">{receiptError}</p>}

              {receipt && (
                <div className="flex flex-col gap-1 rounded-xl border border-line bg-panel2 p-3">
                  <div className="flex items-center pb-1">
                    <p className="text-xs text-dim">분류를 누르면 공통 → 술 → 음료로 바뀌어요</p>
                    <button onClick={() => setReceipt(null)} className="ml-auto text-xs text-faint">
                      접기
                    </button>
                  </div>
                  {receipt.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <button
                        onClick={() => changeCategory(i)}
                        className={`h-7 w-11 shrink-0 rounded-md border text-xs font-medium ${CATEGORY_CLS[item.category]}`}
                      >
                        {CATEGORY_LABEL[item.category]}
                      </button>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className={`tabular shrink-0 ${item.amount < 0 ? 'text-coral' : ''}`}>{won(item.amount)}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-right text-xs text-dim">품목 합계 {won(itemsSum)}</p>
                  {receipt.total === null ? (
                    <p className="text-right text-xs text-amber">영수증 총액을 못 읽어 품목 합계로 채웠어요</p>
                  ) : (
                    receipt.total !== itemsSum && (
                      <p className="text-right text-xs text-amber">
                        영수증 총액 {won(receipt.total)}과 {won(Math.abs(receipt.total - itemsSum))} 달라요. 할인이나
                        봉사료일 수 있어요(차액은 공통에 포함)
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* 금액 — 공통은 자동(총액 − 술 − 음료) */}
          <div className="flex flex-col gap-2">
            <AmountField label="총 금액" value={total} onChange={setTotal} />
            <AmountField label="술값" value={alcohol} onChange={setAlcohol} />
            <AmountField label="음료값" value={beverage} onChange={setBeverage} />
            <p className="text-right text-xs text-faint">
              공통(안주·식사) {common >= 0 ? won(common) : '—'}
            </p>
          </div>

          {/* 인원 — 술·음료 마신 여부로 4그룹 */}
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            {groups.map((g) => (
              <Counter
                key={g.key}
                label={g.label}
                count={g.count}
                onChange={(n) => setCounts((c) => ({ ...c, [g.key]: n }))}
              />
            ))}
            <p className="text-right text-xs text-faint">전원 {headcount}명</p>
          </div>

          {/* 결과 — 입력이 바뀔 때마다 바로 계산 */}
          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            {!result.ok ? (
              <p className="py-2 text-center text-sm text-dim">{result.error}</p>
            ) : (
              <>
                {result.shares.map((s) => (
                  <div
                    key={s.group.key}
                    className="flex items-center rounded-lg border border-line bg-panel2 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{s.group.label}</span>
                    <span className="ml-1.5 text-xs text-faint">{s.group.count}명</span>
                    <span className="tabular ml-auto font-bold text-court">{won(s.perPerson)}</span>
                  </div>
                ))}
                {result.remainder > 0 && (
                  <p className="text-right text-xs text-faint">
                    나누어떨어지지 않아 결제자 부담 {won(result.remainder)}
                  </p>
                )}
                <button
                  onClick={() => void copy()}
                  className={`mt-1 h-11 rounded-xl border text-sm font-bold ${
                    copied === 'done' ? 'border-court bg-court/15 text-court' : 'border-court/50 text-court'
                  }`}
                >
                  {copied === 'done' ? '복사했어요' : '카톡 문구 복사'}
                </button>
                {copied === 'failed' && (
                  <>
                    <p className="text-xs text-coral">자동 복사가 안 돼요. 아래 문구를 길게 눌러 복사해주세요.</p>
                    <textarea
                      readOnly
                      value={text}
                      rows={text.split('\n').length}
                      onFocus={(e) => e.currentTarget.select()}
                      className="resize-none rounded-lg border border-line bg-panel2 p-3 text-sm outline-none"
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
