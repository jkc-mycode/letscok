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

// 복식 종목 구성용 성별 — null(미지정)은 추천 시 와일드카드로 처리
export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

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
  gender: Gender | null; // null = 미지정 (도입 전 기존 회원)
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
  gender: Gender; // 신규 등록은 필수 (남/여)
  isGuest: boolean;
  consent: boolean; // 개인정보 수집·이용 동의 (true여야 등록 가능, 서버가 동의 시각 기록)
}

export interface ICheckInDto {
  memberId: string;
  code?: string; // 현장 체크인 코드(QR ?c=) — 세션에 코드가 있으면 서버가 대조, 불일치·누락 시 거부
}

// 운영진 수동 체크인 — 코드 대조 없음(AdminGuard 뒤). QR 오픈 지연 등 예외 상황용
export interface IManualCheckInDto {
  memberId: string;
}

// 진행 중 세션의 현장 체크인 코드 (운영진 전용 조회 — QR 렌더용). 공개 스냅샷엔 절대 미포함
export interface ICheckInCodeResponse {
  code: string | null;
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

// 선수 교체 (게임 중·대기 조합 공용) — 부상·급한 일로 한 명만 바꿀 때
export interface IReplaceGamePlayerDto {
  outAttendanceId: string; // 빠지는 사람 (이 게임의 플레이어)
  inAttendanceId: string; // 들어오는 사람
}

export interface IAdminLoginDto {
  passcode: string;
}

// ===== 게임 추천 (GET /sessions/:id/game-recommendations) =====

// 후보 성격 — 클라이언트가 한국어 라벨로 표시 (공정성/새 조합/믹스)
// 추천 종목 필터 — 모달 탭과 1:1. ALL이 기본(성별 무관 최적, 미지정 포함)
export const RecommendationCategory = {
  ALL: 'ALL', // 제한 없음 — 기존 동작 (미지정 포함, 표준 복식 소프트 선호)
  MENS: 'MENS', // 남복 4:0
  WOMENS: 'WOMENS', // 여복 0:4
  MIXED: 'MIXED', // 혼복 2:2
  OTHER: 'OTHER', // 기타 3:1 · 1:3
} as const;
export type RecommendationCategory =
  (typeof RecommendationCategory)[keyof typeof RecommendationCategory];

export const RecommendationKind = {
  FAIRNESS: 'FAIRNESS', // 가장 오래 기다린 사람 우선
  FRESH: 'FRESH', // 오늘 안 만난 사람 위주
  MIX: 'MIX', // 상위권 중 무작위
} as const;
export type RecommendationKind =
  (typeof RecommendationKind)[keyof typeof RecommendationKind];

export interface IRecommendedPlayer {
  attendanceId: string;
  memberId: string;
  name: string;
  grade: Grade;
  gender: Gender | null; // 모달 마커 표시용
  isGuest: boolean;
  gamesPlayed: number;
  waitingMinutes: number; // 요청 시점 기준 대기 분
  borrowedFrom: 'QUEUED' | 'PLAYING' | null; // null = 미배정 대기에서 선발, 그 외 = 차용 인원
}

export interface IGameRecommendation {
  kind: RecommendationKind;
  players: IRecommendedPlayer[]; // 4명
  repeatPairCount: number; // 4명 중 오늘 이미 같은 게임을 뛴 쌍의 수 (참고 표시용)
  genderLabel: string; // 성별 구성 라벨 (남복/여복/혼복/혼성 N:N/성별 미정 포함)
}

// ===== 히스토리/전적 (GET /history/*, 운영진 전용) =====

// 지난 모임 목록의 한 줄 — 생년월일 등 이 화면에 불필요한 개인정보는 어디에도 안 내려간다
export interface IHistorySessionSummary {
  id: string;
  date: string; // YYYY-MM-DD
  attendeeCount: number;
  finishedGameCount: number; // FINISHED만 집계 (CANCELED 제외)
}

export interface IHistorySessionListResponse {
  sessions: IHistorySessionSummary[];
  total: number; // 페이지네이션용 전체 CLOSED 세션 수
  page: number;
  limit: number;
}

export interface IHistoryAttendee {
  memberId: string;
  name: string;
  grade: Grade;
  gender: Gender | null;
  isGuest: boolean;
  gamesPlayed: number; // 그날 뛴 게임 수
}

export interface IHistoryGame {
  id: string;
  courtNo: number | null; // 해제(soft-delete)된 코트여도 번호는 표시
  startedAt: string | null;
  endedAt: string | null;
  playerNames: string[]; // 4인
}

export interface IHistorySessionDetail {
  session: IHistorySessionSummary;
  attendees: IHistoryAttendee[]; // 그날 많이 뛴 순
  games: IHistoryGame[]; // 시작 시각 순
}

export interface IHistoryPartner {
  memberId: string;
  name: string;
  gamesTogether: number; // 같은 게임(FINISHED)에서 함께 뛴 횟수
}

export interface IHistoryMemberStats {
  memberId: string;
  name: string;
  grade: Grade;
  gender: Gender | null;
  isGuest: boolean;
  totalSessions: number; // 총 출석 (체크인한 모임 수)
  totalGames: number; // 총 게임 수 (세션별 gamesPlayed 합)
  lastAttendedDate: string | null; // 최근 출석일
  topPartners: IHistoryPartner[]; // 함께 뛴 top 5
  recentSessions: { date: string; gamesPlayed: number }[]; // 최근 모임별 게임 수
}

// 참여 랭킹 한 줄 — 승패가 아니라 참여(출석·게임 수) 기준. 0회 멤버도 포함(멤버 색인 겸용)
export interface IHistoryRankingEntry {
  memberId: string;
  name: string;
  grade: Grade;
  gender: Gender | null;
  isGuest: boolean;
  totalSessions: number; // 출석 수 (months 지정 시 기간 내)
  totalGames: number; // gamesPlayed 합 (동일 기간 기준)
  lastAttendedDate: string | null; // 기간 내 최근 출석일
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
