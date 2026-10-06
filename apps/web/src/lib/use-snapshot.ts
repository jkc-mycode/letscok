'use client';

// 보드 상태의 단일 소스 — REST로 첫 스냅샷을 받고, 이후 소켓 브로드캐스트로 통째로 교체한다
// (운영진 보드와 모임원 화면이 공유하는 훅. 재연결 시에도 REST 재조회 → 같은 경로로 복구)

import {
  ISessionSnapshot,
  SocketClientEvents,
  SocketEvents,
} from '@letscok/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, ApiError, API_URL } from './api';

interface SnapshotState {
  snapshot: ISessionSnapshot | null;
  noSession: boolean; // 진행 중 모임 없음 (404)
  // 서버에 닿지 못함(네트워크·5xx) — 404와 구분해야 "아직 모임 전"으로 잘못 보이지 않는다.
  // 화면은 snapshot이 없을 때만 오류 화면을 띄운다(이미 보드가 떠 있으면 마지막 상태를 그대로 둔다)
  failed: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useSnapshot(): SnapshotState {
  const [snapshot, setSnapshot] = useState<ISessionSnapshot | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null); // connect 핸들러가 최신 세션 id를 참조

  const refetch = useCallback(async () => {
    try {
      const data = await api<ISessionSnapshot>('/sessions/current');
      setSnapshot(data);
      setNoSession(false);
      setFailed(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setSnapshot(null);
        setNoSession(true);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();

    const socket = io(API_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    // 접속(재접속 포함)마다 REST로 최신 상태 복구 — 끊긴 사이 놓친 브로드캐스트 대비
    socket.on('connect', () => {
      void refetch();
      if (sessionIdRef.current) {
        socket.emit(SocketClientEvents.JOIN_SESSION, {
          sessionId: sessionIdRef.current,
        });
      }
    });
    socket.on(SocketEvents.SNAPSHOT_UPDATED, (data: ISessionSnapshot) => {
      setSnapshot(data);
      setNoSession(false);
    });
    socket.on(SocketEvents.SESSION_CLOSED, () => {
      setSnapshot(null);
      setNoSession(true);
    });

    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [refetch]);

  // 처음부터 서버에 닿지 못했으면 5초마다 다시 시도 — 서버가 깨어나면 저절로 화면이 돌아온다
  useEffect(() => {
    if (!failed || snapshot) return;
    const timer = setTimeout(() => void refetch(), 5000);
    return () => clearTimeout(timer);
  }, [failed, snapshot, refetch]);

  // 세션 id를 알게 되는 시점(첫 로드·세션 시작)에 룸 입장 — 중복 join은 무해
  const sessionId = snapshot?.session.id ?? null;
  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (sessionId && socketRef.current?.connected) {
      socketRef.current.emit(SocketClientEvents.JOIN_SESSION, { sessionId });
    }
  }, [sessionId]);

  return { snapshot, noSession, failed, loading, refetch };
}

// 경과 시간 표시용 1초 틱
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function formatElapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatWaitingMinutes(fromIso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  return `${minutes}분`;
}
