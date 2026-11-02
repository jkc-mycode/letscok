'use client';

import { useEffect, useRef, useState } from 'react';

// 카톡 문구 복사 — done은 2초 뒤 사라지고, failed(권한·비보안 주소)는 남아 화면이 직접 복사할 길을 보여 준다
export function useCopy(text: string) {
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied((c) => (c === 'done' ? null : c)), 2000);
  };
  return { copied, copy };
}
