'use client';

import { IAiCheckInStatus, IReceiptReadResult, ReceiptCategory } from '@letscok/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClearableInput } from '@/components/clearable-input';
import { AiThinking } from '@/components/logo-loader';
import { CameraIcon, ImageIcon } from '@/components/icons';
import { Sheet } from '@/components/sheet';
import { api, ApiError } from '@/lib/api';
import { shrinkImage } from '@/lib/image';
import { DEFAULT_GROUPS, parseNames, settle, settlementText, won } from '@/lib/settlement';

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
        className="tabular h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-panel2 px-3 text-right text-base outline-none placeholder:text-faint focus:border-court"
      />
      <span className="text-sm text-dim">원</span>
    </label>
  );
}

// 날짜 입력 값("YYYY-MM-DD", 기기 시간대 기준 오늘)과 문구용 "10월 3일"
const todayInput = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const monthDay = (value: string) => {
  const [, month, day] = value.split('-').map(Number);
  return `${month}월 ${day}일`;
};

const MAX_RECEIPTS = 5; // 서버 한도 — 1차·2차 영수증, 길어서 나눠 찍은 것까지

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

// 영수증 판독 결과를 고칠 수 있게 담아 두는 형태 — 금액은 입력 중인 글자 그대로("-", "" 포함) 들고 있는다
interface DraftItem {
  key: number;
  name: string;
  amountText: string; // "-2000"처럼 할인은 음수
  category: ReceiptCategory;
}
interface ReceiptDraft {
  items: DraftItem[];
  total: number | null; // AI가 읽은 결제 금액
  edited: boolean; // 품목 금액을 고치거나 지우거나 더했으면 총 금액은 품목 합계를 따른다
}

const amountOf = (text: string) => Number(text.replace(/[^\d-]/g, '')) || 0;
// 쉼표를 빼고 앞의 "-" 하나와 숫자만 남긴다(9자리까지)
const cleanAmount = (raw: string) => {
  const negative = raw.trim().startsWith('-');
  return (negative ? '-' : '') + raw.replace(/\D/g, '').slice(0, 9);
};
const amountDisplay = (text: string) => {
  const digits = text.replace(/\D/g, '');
  return digits ? `${text.startsWith('-') ? '-' : ''}${Number(digits).toLocaleString('ko-KR')}` : text;
};

const sumBy = (items: DraftItem[], category?: ReceiptCategory) =>
  items.filter((i) => !category || i.category === category).reduce((sum, i) => sum + amountOf(i.amountText), 0);

// 이름을 적으면 인원수가 이름 수로 고정된다(이름과 인원이 어긋나지 않게) — 이름을 지우면 다시 [-]/[+]
function Counter({
  label,
  count,
  onChange,
  names,
  onNamesChange,
}: {
  label: string;
  count: number;
  onChange: (n: number) => void;
  names: string;
  onNamesChange: (v: string) => void;
}) {
  const locked = parseNames(names).length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm">{label}</span>
        <button
          onClick={() => onChange(Math.max(0, count - 1))}
          disabled={locked || count === 0}
          className="h-10 w-10 rounded-lg bg-panel2 text-lg text-dim disabled:opacity-40"
        >
          −
        </button>
        <input
          value={count === 0 ? '' : String(count)}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '').slice(0, 3) || 0))}
          disabled={locked}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          className="tabular h-10 w-12 rounded-lg border-2 border-transparent bg-panel2 text-center text-base outline-none placeholder:text-faint focus:border-court"
        />
        <button
          onClick={() => onChange(count + 1)}
          disabled={locked}
          className="h-10 w-10 rounded-lg bg-panel2 text-lg text-dim disabled:opacity-40"
        >
          +
        </button>
      </div>
      <ClearableInput
        value={names}
        onChange={(e) => onNamesChange(e.target.value)}
        autoComplete="off"
        placeholder="이름 (선택, 쉼표나 띄어쓰기로 구분)"
        className="h-9 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none placeholder:text-faint focus:border-court"
        onClear={() => onNamesChange('')}
      />
    </div>
  );
}

export function SettlementModal({ onClose }: { onClose: () => void }) {
  const [total, setTotal] = useState('');
  const [alcohol, setAlcohol] = useState('');
  const [beverage, setBeverage] = useState('');
  const [sponsor, setSponsor] = useState(''); // 찬조 — 원 또는 %(sponsorUnit)
  const [sponsorUnit, setSponsorUnit] = useState<'won' | 'percent'>('won');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({}); // 그룹별 이름 입력 원문
  const [place, setPlace] = useState('');
  // 언제 뒤풀이였는지 — 보통 다음 날 공지라 기본 어제, 며칠 지났으면 [날짜]로 고른다
  const [day, setDay] = useState<'오늘' | '어제' | '날짜'>('어제');
  const [date, setDate] = useState(todayInput);
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDraft | null>(null);
  const nextItemKey = useRef(1);
  const [reading, setReading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
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

  // 영수증 품목 → 금액 칸. 총액은 영수증 결제 금액(못 읽었거나 품목을 고쳤으면 품목 합계), 할인으로 음수가 되면 0
  // 품목을 바꿀 때마다 다시 채우므로 금액 칸을 직접 고친 값은 덮어써진다 — 품목을 먼저 맞추고 칸을 고치는 순서
  const updateReceipt = (r: ReceiptDraft) => {
    setReceipt(r);
    const sum = sumBy(r.items);
    setTotal(String(Math.max(0, r.edited || r.total === null ? sum : r.total)));
    setAlcohol(String(Math.max(0, sumBy(r.items, 'alcohol'))));
    setBeverage(String(Math.max(0, sumBy(r.items, 'beverage'))));
  };
  const editItem = (key: number, patch: Partial<DraftItem>, edited: boolean) => {
    if (!receipt) return;
    updateReceipt({
      ...receipt,
      items: receipt.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
      edited: receipt.edited || edited,
    });
  };
  const removeItem = (key: number) => {
    if (!receipt) return;
    updateReceipt({ ...receipt, items: receipt.items.filter((item) => item.key !== key), edited: true });
  };
  const addItem = () => {
    if (!receipt) return;
    const item: DraftItem = { key: nextItemKey.current++, name: '', amountText: '', category: 'common' };
    updateReceipt({ ...receipt, items: [...receipt.items, item], edited: true });
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
      updateReceipt({
        items: result.items.map((item) => ({
          key: nextItemKey.current++,
          name: item.name,
          amountText: String(item.amount),
          category: item.category,
        })),
        total: result.total,
        edited: false,
      });
    } catch (e) {
      setReceiptError(e instanceof ApiError ? e.message : '영수증을 읽지 못했어요. 직접 입력해주세요.');
    } finally {
      setReading(false);
    }
  };

  const itemsSum = receipt ? sumBy(receipt.items) : 0;

  const groups = useMemo(
    () =>
      DEFAULT_GROUPS.map((g) => {
        const list = parseNames(names[g.key] ?? '');
        return { ...g, names: list, count: list.length > 0 ? list.length : (counts[g.key] ?? 0) };
      }),
    [counts, names],
  );
  const headcount = groups.reduce((sum, g) => sum + g.count, 0);
  const common = toNumber(total) - toNumber(alcohol) - toNumber(beverage);
  // % 찬조는 총액 기준 원으로 바꿔 계산한다(반올림). 100%를 넘으면 계산 쪽에서 "총액보다 커요"로 막힌다
  const sponsorWon =
    sponsorUnit === 'won' ? toNumber(sponsor) : Math.round((toNumber(total) * toNumber(sponsor)) / 100);
  const result = useMemo(
    () =>
      settle({
        total: toNumber(total),
        alcohol: toNumber(alcohol),
        beverage: toNumber(beverage),
        sponsor: sponsorWon,
        groups,
      }),
    [total, alcohol, beverage, sponsorWon, groups],
  );
  const when = day === '날짜' ? monthDay(date) : day;
  const text = result.ok ? settlementText({ total: toNumber(total), when, place, shares: result.shares }) : '';

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
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel="뒤풀이 정산"
      dismissible={false}
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">🍻 뒤풀이 정산</h2>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 scroll-area">
        {/* 영수증으로 채우기 — AI가 품목을 공통·술·음료로 나누고, 칩을 눌러 고친다 */}
        {aiEnabled && (
          <div className="flex flex-col gap-2">
            {/* 촬영 = 바로 후면 카메라(1장), 앨범 = 찍어 둔 사진 최대 5장 */}
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void readReceipt(e.target.files);
                e.target.value = ''; // 같은 사진을 다시 골라도 onChange가 오게
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void readReceipt(e.target.files);
                e.target.value = '';
              }}
            />
            {reading ? (
              <AiThinking
                className="min-h-11 justify-center rounded-xl bg-court/10 px-3 py-2"
                steps={['영수증을 올리는 중이에요', '영수증을 읽는 중이에요', '품목을 나누는 중이에요']}
              />
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => cameraInput.current?.click()}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-court/10 text-body-sm font-bold text-court"
                >
                  <CameraIcon /> 영수증 촬영
                </button>
                <button
                  onClick={() => fileInput.current?.click()}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-court/10 text-body-sm font-bold text-court"
                >
                  <ImageIcon /> 앨범 (최대 {MAX_RECEIPTS}장)
                </button>
              </div>
            )}
            {receiptError && <p className="text-xs font-medium text-coral">{receiptError}</p>}

            {receipt && (
              <div className="flex flex-col gap-1 rounded-xl bg-panel2 p-3">
                <div className="flex items-center pb-1">
                  <p className="text-xs text-dim">분류를 누르면 공통 → 술 → 음료로 바뀌고, 이름·금액은 눌러서 고쳐요</p>
                  <button onClick={() => setReceipt(null)} className="tap ml-auto text-xs text-dim">
                    접기
                  </button>
                </div>
                {receipt.items.map((item) => (
                  <div key={item.key} className="flex items-center gap-1.5 text-sm">
                    <button
                      onClick={() => editItem(item.key, { category: NEXT_CATEGORY[item.category] }, false)}
                      className={`tap h-8 w-11 shrink-0 rounded-md border text-xs font-medium ${CATEGORY_CLS[item.category]}`}
                    >
                      {CATEGORY_LABEL[item.category]}
                    </button>
                    <ClearableInput
                      value={item.name}
                      onChange={(e) => editItem(item.key, { name: e.target.value }, false)}
                      autoComplete="off"
                      maxLength={40}
                      placeholder="품목 이름"
                      className="h-8 rounded-md border border-transparent bg-transparent px-1.5 outline-none placeholder:text-faint focus:border-court"
                      onClear={() => editItem(item.key, { name: '' }, false)}
                      wrapperClassName="min-w-0 flex-1"
                    />
                    <input
                      value={amountDisplay(item.amountText)}
                      onChange={(e) => editItem(item.key, { amountText: cleanAmount(e.target.value) }, true)}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      className={`tabular h-8 w-24 shrink-0 rounded-md border-2 border-transparent bg-panel2 px-2 text-right outline-none placeholder:text-faint focus:border-court ${
                        amountOf(item.amountText) < 0 ? 'text-coral' : ''
                      }`}
                    />
                    <button
                      onClick={() => removeItem(item.key)}
                      title="이 줄 지우기"
                      className="tap h-8 w-7 shrink-0 text-dim hover:text-coral"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button onClick={addItem} className="mt-1 h-8 rounded-md border border-dashed border-line text-xs text-dim">
                  + 품목 추가
                </button>
                <p className="pt-1 text-right text-xs text-dim">품목 합계 {won(itemsSum)}</p>
                {receipt.edited ? (
                  <p className="text-right text-xs text-faint">품목을 고쳐서 총 금액을 품목 합계로 채웠어요</p>
                ) : receipt.total === null ? (
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
          {/* 찬조 — 원 또는 %. 공통·술·음료를 같은 비율로 줄인다. 카톡 문구엔 표시하지 않는다 */}
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-sm text-dim">찬조</span>
            <input
              value={sponsorUnit === 'won' ? withCommas(sponsor) : sponsor}
              onChange={(e) => {
                const digits = digitsOnly(e.target.value);
                setSponsor(sponsorUnit === 'won' ? digits : digits.slice(0, 3)); // %는 세 자리까지
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              className="tabular h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-panel2 px-3 text-right text-base outline-none placeholder:text-faint focus:border-court"
            />
            <div className="flex shrink-0 overflow-hidden rounded-lg bg-panel2 text-sm">
              {(['won', 'percent'] as const).map((unit) => (
                <button
                  key={unit}
                  onClick={() => {
                    setSponsorUnit(unit);
                    setSponsor(''); // 단위가 바뀌면 숫자의 의미가 달라져 비운다
                  }}
                  className={`h-11 w-9 ${sponsorUnit === unit ? 'bg-court/15 font-bold text-court' : 'text-dim'}`}
                >
                  {unit === 'won' ? '원' : '%'}
                </button>
              ))}
            </div>
          </div>
          {sponsorWon > 0 && (
            <p className="text-right text-xs text-faint">
              찬조 {won(sponsorWon)} 빼고 {won(Math.max(0, toNumber(total) - sponsorWon))}을 나눠요
            </p>
          )}
        </div>

        {/* 인원 — 술·음료 마신 여부로 4그룹 */}
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {groups.map((g) => (
            <Counter
              key={g.key}
              label={g.label}
              count={g.count}
              onChange={(n) => setCounts((c) => ({ ...c, [g.key]: n }))}
              names={names[g.key] ?? ''}
              onNamesChange={(v) => setNames((c) => ({ ...c, [g.key]: v }))}
            />
          ))}
          <p className="text-right text-xs text-faint">전원 {headcount}명</p>
        </div>

        {/* 카톡 문구 머리말 — "어제 옛날집 정산 안내드립니다!" / "10월 3일 옛날집 …" */}
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            {(['오늘', '어제', '날짜'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`h-10 shrink-0 rounded-lg border px-3 text-sm ${
                  day === d ? 'border-court bg-court/15 text-court' : 'border-line text-dim'
                }`}
              >
                {d}
              </button>
            ))}
            {day === '날짜' && (
              <input
                type="date"
                value={date}
                max={todayInput()}
                onChange={(e) => e.target.value && setDate(e.target.value)} // 지우기 버튼으로 빈 값이 오면 무시
                className="h-10 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-panel2 px-2 text-sm outline-none focus:border-court"
              />
            )}
          </div>
          <ClearableInput
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            autoComplete="off"
            maxLength={30}
            placeholder="가게 이름 (선택)"
            className="h-10 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none placeholder:text-faint focus:border-court"
            onClear={() => setPlace('')}
          />
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
                  className="flex items-center rounded-lg bg-panel2 px-3 py-2 text-sm"
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
                    className="resize-none rounded-lg bg-panel2 p-3 text-sm outline-none"
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
