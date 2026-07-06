// 렛츠콕 공유 타입 — 서버(Prisma enum)와 웹이 동일한 값을 참조한다

// ===== Enums =====

export const Grade = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
} as const;
export type Grade = (typeof Grade)[keyof typeof Grade];

export const SessionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const CourtStatus = {
  IDLE: 'IDLE',
  IN_GAME: 'IN_GAME',
} as const;
export type CourtStatus = (typeof CourtStatus)[keyof typeof CourtStatus];

export const AttendanceStatus = {
  CHECKED_IN: 'CHECKED_IN', // 미배정 대기
  MATCHED: 'MATCHED', // 4인 조합에 포함되어 코트 대기
  PLAYING: 'PLAYING', // 게임 중
  LEFT: 'LEFT', // 퇴장 (재입장 시 CHECKED_IN 복귀)
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const GameStatus = {
  QUEUED: 'QUEUED', // 대기 조합 (코트 미배정)
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
  CANCELED: 'CANCELED', // 조합 해체
} as const;
export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus];

// ===== Entities =====

export interface IMember {
  id: string;
  name: string;
  birthDate: string; // YYYY-MM-DD (동명이인 구분용 노출)
  grade: Grade;
  isGuest: boolean;
  createdAt: string;
}

export interface ISession {
  id: string;
  date: string; // YYYY-MM-DD
  status: SessionStatus;
  openedAt: string;
  closedAt: string | null;
}

export interface ICourt {
  id: string;
  sessionId: string;
  courtNo: number; // 체육관 실제 코트 번호
  status: CourtStatus;
}

export interface IAttendance {
  id: string;
  sessionId: string;
  memberId: string;
  status: AttendanceStatus;
  checkedInAt: string;
  waitingSince: string; // 대기 시작 시각 (게임 종료·재입장 시 갱신)
  gamesPlayed: number; // 오늘 완료한 게임 수
  leftAt: string | null;
  member?: IMember;
}

export interface IGame {
  id: string;
  sessionId: string;
  courtId: string | null; // QUEUED 상태에서는 null
  status: GameStatus;
  queuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  queueOrder: number | null; // 대기 조합 정렬 순서
  players?: IGamePlayer[];
}

export interface IGamePlayer {
  id: string;
  gameId: string;
  attendanceId: string;
  attendance?: IAttendance;
}

// ===== DTOs =====

export interface ICreateMemberDto {
  name: string;
  birthDate: string; // YYYY-MM-DD
  grade: Grade;
  isGuest: boolean;
}

export interface ICheckInDto {
  memberId: string;
}

export interface ICreateCourtDto {
  courtNo: number;
}

export interface ICreateGameDto {
  attendanceIds: [string, string, string, string]; // 정확히 4명
}

export interface IAssignGameDto {
  courtId: string;
}

export interface IUpdateGameOrderDto {
  queueOrder: number;
}

export interface IAdminLoginDto {
  passcode: string;
}

// ===== 실시간 세션 스냅샷 (GET /sessions/current, 재연결 시 재조회) =====

export interface ISessionSnapshot {
  session: ISession;
  courts: ICourt[];
  attendances: IAttendance[];
  games: IGame[]; // QUEUED + PLAYING (오늘 FINISHED 포함 여부는 쿼리 옵션)
}

// ===== 공통 응답 래퍼 =====

export interface IApiResponse<T> {
  success: boolean;
  data: T;
}

// ===== Socket.IO 이벤트 =====

// 서버 → 클라이언트: 어떤 변경이든 전체 스냅샷을 다시 쏜다
// (소모임 규모라 이벤트별 부분 머지 대신 setState(snapshot) 한 번으로 단순화,
//  재연결 복구와 동일 경로가 되어 상태 불일치 여지가 없음)
export const SocketEvents = {
  SNAPSHOT_UPDATED: 'snapshot.updated', // payload: ISessionSnapshot
  SESSION_CLOSED: 'session.closed', // payload: { sessionId: string }
} as const;
export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];

// 클라이언트 → 서버: 세션 룸 입장
export const SocketClientEvents = {
  JOIN_SESSION: 'session.join', // payload: IJoinSessionPayload
} as const;
export type SocketClientEvent =
  (typeof SocketClientEvents)[keyof typeof SocketClientEvents];

export interface IJoinSessionPayload {
  sessionId: string;
}
