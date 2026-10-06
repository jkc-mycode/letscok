'use client';

import { IHistorySessionDetail } from '@letscok/shared-types';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { api, ApiError } from '@/lib/api';
import { sessionReportText } from '@/lib/session-report';

const DEFAULT_CLOSING = '오늘도 수고 많으셨어요! 다음 모임에서 만나요 😊';

// 모임 마무리 문구 — 항목을 켜고 끄며 미리보기를 보고 카톡용으로 복사한다(저장하지 않음)
export function SessionReportModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<IHistorySessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(true);
  const [showTop, setShowTop] = useState(true);
  const [closing, setClosing] = useState(DEFAULT_CLOSING);
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    api<IHistorySessionDetail>(`/history/sessions/${sessionId}`, { admin: true })
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? e.message : '기록을 불러오지 못했어요.'));
  }, [sessionId]);

  const text = detail
    ? sessionReportText({
        date: detail.session.date,
        attendeeCount: detail.session.attendeeCount,
        gameCount: detail.session.finishedGameCount,
        attendees: detail.attendees,
        showSummary,
        showTop,
        closing,
      })
    : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied('failed'); // 권한·비보안 환경 — 미리보기를 길게 눌러 직접 복사
    }
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied((c) => (c === 'done' ? null : c)), 2000);
  };

  const toggle = (on: boolean, set: (v: boolean) => void, label: string) => (
    <button
      onClick={() => set(!on)}
      className={`h-10 rounded-lg border px-3 text-sm ${
        on ? 'border-court bg-court/15 font-medium text-court' : 'border-line text-dim'
      }`}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  );

  return (
    // 끝인사를 고치는 중일 수 있어 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel="모임 마무리 문구"
      dismissible={false}
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={<h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">🏸 모임 마무리 문구</h2>}
      footer={
        detail && (
          <button
            onClick={() => void copy()}
            className={`h-12 w-full rounded-xl text-sm font-bold ${
              copied === 'done' ? 'border border-court bg-court/15 text-court' : 'bg-court text-bg'
            }`}
          >
            {copied === 'done' ? '복사했어요' : '카톡 문구 복사'}
          </button>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 scroll-area">
        {error && <p className="py-6 text-center text-sm text-coral">{error}</p>}
        {!error && !detail && <p className="py-6 text-center text-sm text-dim">불러오는 중...</p>}
        {detail && (
          <>
            <div className="flex flex-wrap gap-2">
              {toggle(showSummary, setShowSummary, '출석·게임 수')}
              {toggle(showTop, setShowTop, '많이 뛴 분')}
            </div>
            <textarea
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder="끝인사 (비우면 넣지 않아요)"
              className="resize-none rounded-lg border border-line bg-panel2 p-3 text-sm outline-none placeholder:text-faint focus:border-court"
            />
            <p className="text-xs text-dim">미리보기</p>
            <pre className="rounded-lg border border-line bg-panel2 p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap select-text">
              {text}
            </pre>
            {copied === 'failed' && (
              <p className="text-xs text-coral">자동 복사가 안 돼요. 미리보기를 길게 눌러 복사해주세요.</p>
            )}
          </>
        )}
      </div>

    </Sheet>
  );
}
