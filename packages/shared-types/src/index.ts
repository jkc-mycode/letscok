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

// 모임 내 역할 — 표시·명단 관리용 구분. 인증 권한은 단일 패스코드 그대로(별도 권한 단계 없음)
export const MemberRole = {
  LEADER: 'LEADER', // 모임장
  MANAGER: 'MANAGER', // 운영진
  MEMBER: 'MEMBER', // 모임원
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

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
  RESTING: 'RESTING', // 잠깐 휴식 — 조합 대상에서 제외, 복귀 시 대기시간 리셋
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
  birthDate: string | null; // YYYY-MM-DD (동명이인 구분용 노출) — 게스트는 null
  grade: Grade;
  gender: Gender | null; // null = 미지정 (도입 전 기존 회원)
  isGuest: boolean;
  role: MemberRole; // 모임장/운영진/모임원 — 게스트는 항상 MEMBER
  consented: boolean; // 개인정보 동의 이력 — false면 첫 체크인 때 본인 동의를 받아야 한다
  createdAt: string;
}

// 명단 관리 목록 행 — 회원 정보 + 출석 집계 (관제판 [모임원 관리] 전용, AdminGuard 뒤)
export interface IMemberSummary extends IMember {
  deletedAt: string | null; // 삭제된 회원도 목록에 실어 복구를 지원한다
  lastAttendedAt: string | null; // 마지막 출석 세션 날짜 (YYYY-MM-DD) — 없으면 미출석
  totalSessions: number;
  totalGames: number;
}

// 회원 정보 수정 — 모든 필드 선택적(보낸 것만 반영). isGuest는 false만 허용(게스트→정회원 승격 전용)
export interface IUpdateMemberDto {
  name?: string;
  birthDate?: string; // YYYY-MM-DD
  grade?: Grade;
  gender?: Gender;
  role?: MemberRole;
  isGuest?: boolean;
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
  isShared: boolean; // 다른 모임과 번갈아 쓰는 공유 코트 여부
  ourTurn: boolean; // 공유 코트의 현재 차례 (비공유 코트는 항상 true)
}

export interface IAttendance {
  id: string;
  sessionId: string;
  memberId: string;
  status: AttendanceStatus;
  checkedInAt: string;
  waitingSince: string; // 대기 시작 시각 (게임 종료·재입장·콕 확인 시 갱신)
  gamesPlayed: number; // 오늘 완료한 게임 수
  leftAt: string | null;
  shuttleConfirmedAt: string | null; // 콕 제출 확인 시각 — null이면 게임 배정 불가
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
  birthDate?: string; // YYYY-MM-DD — 정회원 필수, 게스트는 생략(서버가 null 저장)
  grade: Grade;
  gender: Gender; // 신규 등록은 필수 (남/여)
  isGuest: boolean;
}

export interface ICheckInDto {
  memberId: string;
  code?: string; // 체크인 코드(공지 작성월일 4자리) — 세션에 코드가 있으면 서버가 대조, 불일치·누락 시 거부
  consent?: boolean; // 동의 이력이 없는 회원(운영진 대리 등록)의 첫 체크인에만 필요
}

// 운영진 수동 체크인 — 코드 대조 없음(AdminGuard 뒤). 사전 등록·현장 대리 등 예외 상황용
export interface IManualCheckInDto {
  memberId: string;
}

// 관제판 운영 메모 (운영진 전용 — 이름·건강 정보가 적히므로 공개 응답엔 절대 미포함)
// 세션 무관 전역: 모임 종료에도 유지, 삭제 = 완료 처리
export interface IAdminMemo {
  id: string;
  content: string;
  createdAt: string;
}

export interface ICreateMemoDto {
  content: string;
}

// 진행 중 세션의 체크인 코드 (운영진 전용 조회 — 관제판 표시·변경용). 공개 스냅샷엔 절대 미포함
export interface ICheckInCodeResponse {
  code: string | null;
}

// 코드 변경 (운영진 전용) — 영문 대문자·숫자 4~8자. 변경값은 다음 모임에 승계된다
export interface IUpdateCheckInCodeDto {
  code: string;
}

export interface ICreateCourtDto {
  courtNo: number;
}

// 공유 코트 설정 — 다른 모임과 번갈아 쓰는 코트 지정/해제 (해제 시 차례도 우리로 리셋)
export interface IUpdateCourtSharedDto {
  isShared: boolean;
}

// 공유 코트 차례 변경 — 상대 게임이 끝나면 운영진이 우리 차례로 되돌린다 (멱등하게 값 지정)
export interface IUpdateCourtTurnDto {
  ourTurn: boolean;
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

export interface IHistoryGamePlayer {
  name: string;
  grade: Grade; // 동명이인 구분용
}

export interface IHistoryGame {
  id: string;
  courtNo: number | null; // 해제(soft-delete)된 코트여도 번호는 표시
  startedAt: string | null;
  endedAt: string | null;
  players: IHistoryGamePlayer[]; // 4인
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
