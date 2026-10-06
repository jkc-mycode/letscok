'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 화면 아래 알림 — 성공(초록)·오류(빨강)를 나누고, 새 알림이 오면 이전 타이머를 지워 연달아 떠도 제 시간만큼 보인다
export type ToastTone = 'error' | 'success';
export interface ToastState {
  message: string;
  tone: ToastTone;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'error', ms = 3000) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);

  return { toast, showToast };
}
