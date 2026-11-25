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
  stale: boolean; // 실시간 연결이 끊겼거나 마지막 조회가 실패함 — 보이는 현황이 최신이 아닐 수 있다
  setDetail: (next: ITournamentDetail | null) => void; // 관제판이 저장 응답을 바로 반영할 때
}

export function useTournamentLive({ admin = false }: { admin?: boolean } = {}): TournamentLiveState {
  const [detail, setShown] = useState<ITournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const lastFetchAt = useRef(0);
  // 가장 나중에 시작한 조회의 응답만 반영한다 — 운영진 둘이 연달아 조작하면 응답이 뒤바뀌어 도착해 옛 현황이 화면에 남을 수 있다
  const latest = useRef(0);

  const load = useCallback(async () => {
    lastFetchAt.current = Date.now();
    const mine = ++latest.current;
    try {
      const data = await api<ITournamentDetail | null>(admin ? '/tournaments/current' : '/tournaments/live', { admin });
      if (mine !== latest.current) return;
      setShown(data ?? null);
      setFailed(false);
    } catch {
      if (mine === latest.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [admin]);

  // 저장 응답은 바로 보여 주되, 그 사이 다른 기기의 변경이 있었을 수 있어 곧바로 다시 읽어 맞춘다
  const setDetail = useCallback(
    (next: ITournamentDetail | null) => {
      latest.current += 1;
      setShown(next);
      void load();
    },
    [load],
  );

  useEffect(() => {
    void load();
    const socket = io(API_URL, { transports: ['websocket'] });
    // 접속(재접속 포함)마다 다시 읽는다 — 끊긴 사이 놓친 신호 대비. 첫 접속은 방금 읽었으니 건너뛴다
    socket.on('connect', () => {
      setOffline(false);
      if (Date.now() - lastFetchAt.current > 3000) void load();
    });
    // 끊기면 socket.io가 알아서 다시 붙는다 — 그동안 화면이 멈춰 있다는 것만 알린다
    socket.on('disconnect', () => setOffline(true));
    socket.on('connect_error', () => setOffline(true));
    socket.on(SocketEvents.TOURNAMENT_CHANGED, () => void load());
    return () => {
      socket.close();
    };
  }, [load]);

  return { detail, loading, failed, stale: offline || failed, setDetail };
}
