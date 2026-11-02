'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

// 운영진 화면 공용 한 번 불러오기 — data가 null이고 error도 null이면 불러오는 중
// setData: 저장 뒤 화면에서 바로 고칠 때. 주소가 바뀌면 앞 요청의 응답은 버린다(늦게 온 옛 결과가 지금 결과를 덮지 않게)
export function useApiQuery<T>(path: string, failMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api<T>(path, { admin: true })
      .then((result) => alive && setData(result))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : failMessage));
    return () => {
      alive = false;
    };
  }, [path, failMessage]);
  return { data, error, setData };
}
