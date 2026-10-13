'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 화면 아래 알림 — 성공(초록)·오류(빨강)를 나누고, 새 알림이 오면 이전 타이머를 지워 연달아 떠도 제 시간만큼 보인다
export type ToastTone = 'error' | 'success';
export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastState {
  message: string;
  tone: ToastTone;
  action?: ToastAction; // [되돌리기]처럼 알림 안 버튼 하나
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'error', ms = 3000, action?: ToastAction) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone, action });
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);
  const hideToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  return { toast, showToast, hideToast };
}
