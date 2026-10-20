'use client';

import { IMember } from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { api } from './api';

const DEBOUNCE_MS = 300; // 입력 후 이만큼 조용하면 검색 — 타이핑마다 요청하지 않게

// 모임원 이름 검색(초성 포함) — 체크인·수동 체크인·AI 출석 연결·신규 등록 비슷한 이름 공용
// 검색어가 바뀌면 앞서 보낸 요청의 응답은 버린다(늦게 온 옛 결과가 지금 결과를 덮지 않게)
// admin: 운영진 화면 — 전체 생년월일 등 운영진 전용 응답. enabled=false면 검색하지 않고 비운다(접힌 패널 등)
export function useMemberSearch(query: string, { admin = false, enabled = true }: { admin?: boolean; enabled?: boolean } = {}): IMember[] {
  const [results, setResults] = useState<IMember[]>([]);
  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !trimmed) {
      setResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api<IMember[]>(`/members/search?name=${encodeURIComponent(trimmed)}`, { admin })
        .then((list) => alive && setResults(list))
        .catch(() => alive && setResults([]));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, admin, enabled]);
  return results;
}
