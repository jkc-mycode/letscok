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
import { getMemberId } from './member';

// 여복·남복처럼 동시에 연 모임 중 이 기기가 보는 모임 — 다시 열어도 같은 보드가 뜨게 기억한다
const PICKED_SESSION_KEY = 'letscok.pickedSessionId';
function readPicked(): string | null {
  try {
    return localStorage.getItem(PICKED_SESSION_KEY);
  } catch {
    return null;
  }
}
function savePicked(id: string) {
  try {
    localStorage.setItem(PICKED_SESSION_KEY, id);
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만 바뀐다
  }
}

interface SnapshotState {
  snapshot: ISessionSnapshot | null;
  noSession: boolean; // 진행 중 모임 없음 (404)
  // 서버에 닿지 못함(네트워크·5xx) — 404와 구분해야 "아직 모임 전"으로 잘못 보이지 않는다.
  // 화면은 snapshot이 없을 때만 오류 화면을 띄운다(이미 보드가 떠 있으면 마지막 상태를 그대로 둔다)
  failed: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
  memosVersion: number; // 운영 메모가 바뀐 신호를 받을 때마다 +1 — 메모 패널은 이때만 다시 읽는다
  selectSession: (id: string) => Promise<void>; // 동시에 연 다른 모임으로 바꿔 보기
}

// byMember: 모임원 화면 — 이 폰에 연결된 사람이 출석한 모임을 받는다(기기에 고른 모임 대신)
export function useSnapshot({ byMember = false }: { byMember?: boolean } = {}): SnapshotState {
  const [snapshot, setSnapshot] = useState<ISessionSnapshot | null>(null);
  const [noSession, setNoSession] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memosVersion, setMemosVersion] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const lastFetchAt = useRef(0); // 마지막 조회를 시작한 시각 — 첫 접속 때 방금 한 조회를 또 하지 않게
  const sessionIdRef = useRef<string | null>(null); // connect 핸들러가 최신 세션 id를 참조

  const refetch = useCallback(async () => {
    lastFetchAt.current = Date.now();
    try {
      const memberId = byMember ? getMemberId() : null;
      const picked = byMember ? null : readPicked();
      const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : picked ? `?id=${encodeURIComponent(picked)}` : '';
      const data = await api<ISessionSnapshot>(`/sessions/current${query}`);
      sessionIdRef.current = data.session.id; // 모임을 바꾼 직후 옛 모임 방의 현황이 새 화면을 덮지 않게 바로 맞춘다
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
  }, [byMember]);

  useEffect(() => {
    void refetch();

    const socket = io(API_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    // 접속(재접속 포함)마다 REST로 최신 상태 복구 — 끊긴 사이 놓친 브로드캐스트 대비
    // 첫 접속은 보통 위의 첫 조회 직후라 3초 안이면 건너뛴다(같은 현황을 두 번 받던 것)
    socket.on('connect', () => {
      if (Date.now() - lastFetchAt.current > 3000) void refetch();
      if (sessionIdRef.current) {
        socket.emit(SocketClientEvents.JOIN_SESSION, {
          sessionId: sessionIdRef.current,
        });
      }
    });
    // 모임을 바꿔 보면 전에 보던 모임 방에도 남아 있다 — 지금 보는 모임 것만 받는다
    socket.on(SocketEvents.SNAPSHOT_UPDATED, (data: ISessionSnapshot) => {
      if (sessionIdRef.current && data.session.id !== sessionIdRef.current) return;
      setSnapshot(data);
      setNoSession(false);
    });
    socket.on(SocketEvents.MEMOS_CHANGED, () => setMemosVersion((v) => v + 1));
    // 동시에 연 다른 모임이 남아 있을 수 있어 바로 "모임 전"으로 두지 않고 다시 읽는다(없으면 404 → 모임 전)
    socket.on(SocketEvents.SESSION_CLOSED, (payload?: { sessionId?: string }) => {
      if (payload?.sessionId && payload.sessionId !== sessionIdRef.current) return;
      void refetch();
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

  const selectSession = useCallback(
    async (id: string) => {
      savePicked(id);
      await refetch();
    },
    [refetch],
  );

  return { snapshot, noSession, failed, loading, refetch, memosVersion, selectSession };
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
