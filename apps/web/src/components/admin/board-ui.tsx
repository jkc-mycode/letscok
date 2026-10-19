'use client';

import { IPushCallResult, MemberRole } from '@letscok/shared-types';
import { useEffect, useRef, useState } from 'react';
import { CrownIcon } from '@/components/icons';
import { api, ApiError } from '@/lib/api';
import { formatElapsed, formatWaitingMinutes, useNow } from '@/lib/use-snapshot';

// 관제판 공용 작은 부품 — 구역 틀, 호출 버튼, [⋯] 버튼, 왕관·게스트 표시, 길게 누르기, 시간 글자

// 1초마다 바뀌는 시간 글자 — 시계를 이 글자 안에만 둔다. 보드가 시계를 들면 매초 카드·명단 전체를 다시 그려 끌기가 끊긴다
export function ElapsedText({ since }: { since: string }) {
  return <>{formatElapsed(since, useNow())}</>;
}

// 오래 기다린 사람 강조 기준(분) — 15분 주황, 20분 빨강
const WAIT_WARN_MINUTES = 15;
const WAIT_ALERT_MINUTES = 20;

// alert: 아직 조합에 안 든 대기 인원만 — 조합에 든 사람·휴식은 이미 처리된 상태라 색을 칠하지 않는다
export function WaitingMinutesText({ since, alert = false }: { since: string; alert?: boolean }) {
  const now = useNow();
  const text = formatWaitingMinutes(since, now);
  if (!alert) return <>{text}</>;
  const minutes = (now - new Date(since).getTime()) / 60000;
  const cls = minutes >= WAIT_ALERT_MINUTES ? 'font-bold text-coral' : minutes >= WAIT_WARN_MINUTES ? 'font-bold text-amber' : '';
  return cls ? <span className={cls}>{text}</span> : <>{text}</>;
}

export function Zone({
  title,
  accent,
  count,
  children,
  footer,
  headerExtra,
  className = '',
}: {
  title: string;
  accent: string;
  count: number;
  children: React.ReactNode;
  footer?: React.ReactNode; // 스크롤 영역 밖 하단 고정 바 (목록이 밑으로 비치지 않음)
  headerExtra?: React.ReactNode; // 제목 오른쪽 컨트롤 (예: 게임 중 포함 토글)
  className?: string; // 컬럼 분할 시 flex-1 부여용
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-2xl bg-panel ${className}`}>
      <h2 className={`flex items-center gap-2 px-3.5 pt-3 pb-2 text-body-sm font-bold ${accent}`}>
        {title}
        <span className="tabular font-mono text-caption text-faint">{count}</span>
        {headerExtra}
      </h2>
      <div className="no-shrink flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {children}
      </div>
      {footer && <div className="flex gap-2 p-3">{footer}</div>}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center p-6 text-center text-body-sm text-faint">
      {children}
    </p>
  );
}

// 운영진 호출·코트 다시 알림 공용 버튼 — 결과를 버튼 자리에 3초 보여준다
// (보드 토스트는 에러 전용 색이라, "몇 대에 보냈는지 / 알림 미등록"은 버튼 안에서 바로 확인)
export function CallButton({
  path,
  label,
  title,
  className,
  idleCls,
}: {
  path: string;
  label: React.ReactNode; // 글자 또는 아이콘 + 글자
  title: string;
  className: string; // 크기·테두리만 — 글자색은 상태별로 갈리므로 idleCls로 따로 받는다
  idleCls: string;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; cls: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = (text: string, cls: string) => {
    setFeedback({ text, cls });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 3000);
  };

  const call = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 대기 행 선택 토글과 분리
    if (busy) return;
    setBusy(true);
    try {
      const { devices } = await api<IPushCallResult>(path, { method: 'POST', admin: true });
      // 0대 = 알림을 등록하지 않은 사람 — 직접 불러야 한다
      if (devices > 0) show(`${devices}대 전송`, 'text-court');
      else show('알림 미등록', 'text-amber');
    } catch (err) {
      show(err instanceof ApiError && err.status === 429 ? '잠시 후' : '실패', 'text-coral');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={(e) => void call(e)}
      disabled={busy}
      title={feedback?.text === '알림 미등록' ? '알림을 등록하지 않은 분이에요 — 직접 불러주세요' : title}
      className={`${className} disabled:opacity-50 ${feedback?.cls ?? idleCls}`}
    >
      {feedback?.text ?? label}
    </button>
  );
}

// 길게 누르기(약 0.45초) — 손가락이 움직이면 취소(스크롤·구역 넘기기와 구분). 뗄 때 오는 클릭은 consumeFired로 걸러 낸다
export function useLongPress(onLongPress: () => void, enabled: boolean, ms = 450) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const handlers = enabled
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          fired.current = false;
          start.current = { x: e.clientX, y: e.clientY };
          cancel();
          timer.current = window.setTimeout(() => {
            fired.current = true;
            navigator.vibrate?.(15);
            onLongPress();
          }, ms);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // 안드로이드 길게 누르기 메뉴 막기
      }
    : {};
  const consumeFired = () => {
    const was = fired.current;
    fired.current = false;
    return was;
  };
  return { handlers, consumeFired };
}

// 모임장(주황)·운영진(초록) 왕관 — 글자 칩보다 자리를 덜 차지한다
export function RoleCrown({ role }: { role: MemberRole }) {
  if (role === 'MEMBER') return null;
  const label = role === 'LEADER' ? '모임장' : '운영진';
  return (
    <span title={label} className={`flex shrink-0 ${role === 'LEADER' ? 'text-amber' : 'text-court'}`}>
      <CrownIcon size={14} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// 게스트 표시 — 폰에선 "G"로 짧게(이름 자리를 지키려고), 넓은 화면에선 "게스트"
export function GuestMark() {
  return (
    <span className="shrink-0 text-caption text-sky">
      <span className="sm:hidden">G</span>
      <span className="hidden sm:inline">게스트</span>
    </span>
  );
}

// 카드의 [⋯] — 자주 안 쓰는 동작을 시트로 모은다
export function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-panel text-lg leading-none text-dim"
    >
      ⋯
    </button>
  );
}
