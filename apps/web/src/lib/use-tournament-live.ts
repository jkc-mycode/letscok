'use client';

// 대회 현황 — REST로 읽고, 서버가 "대회가 바뀌었다"는 신호를 보내면 다시 읽는다
// 모임원 화면·전광판은 공개 현황(/tournaments/live), 관제판은 운영진 조회(/tournaments/current)를 같은 훅으로 쓴다

import { ITournamentDetail, SocketEvents } from '@letscok/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from './api';

interface TournamentLiveState {
  detail: ITournamentDetail | null; // null = 대회 없음(또는 아직 못 읽음)
  loading: boolean; // 첫 조회가 끝나기 전
  failed: boolean; // 서버에 닿지 못함 — 마지막으로 읽은 현황은 그대로 둔다
  setDetail: (next: ITournamentDetail | null) => void; // 관제판이 저장 응답을 바로 반영할 때
}

export function useTournamentLive({ admin = false }: { admin?: boolean } = {}): TournamentLiveState {
  const [detail, setDetail] = useState<ITournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const lastFetchAt = useRef(0);

  const load = useCallback(async () => {
    lastFetchAt.current = Date.now();
    try {
      const data = await api<ITournamentDetail | null>(admin ? '/tournaments/current' : '/tournaments/live', { admin });
      setDetail(data ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    void load();
    const socket = io(API_URL, { transports: ['websocket'] });
    // 접속(재접속 포함)마다 다시 읽는다 — 끊긴 사이 놓친 신호 대비. 첫 접속은 방금 읽었으니 건너뛴다
    socket.on('connect', () => {
      if (Date.now() - lastFetchAt.current > 3000) void load();
    });
    socket.on(SocketEvents.TOURNAMENT_CHANGED, () => void load());
    return () => {
      socket.close();
    };
  }, [load]);

  return { detail, loading, failed, setDetail };
}
