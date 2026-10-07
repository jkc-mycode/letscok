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
  createdAt: string; // 등록 시각(ISO) — 최근 등록순 정렬
}

// 모임원 관리 목록 — 탭(전체·모임원·게스트·삭제됨) + 이름 검색 + 100명씩 페이지
export type MemberListFilter = 'ALL' | 'REGULAR' | 'GUEST' | 'DELETED';
// 정렬 — 최근 출석(기본)·이름·출석 많은 순·최근 등록·급수(A→F)
export type MemberListSort = 'RECENT' | 'NAME' | 'ATTENDANCE' | 'CREATED' | 'GRADE';
export const MEMBER_PAGE_SIZE = 100;

export interface IMemberPage {
  items: IMemberSummary[]; // 이 페이지의 최대 100명 — 최근 출석순(미출석은 맨 아래), 동률은 이름순
  total: number; // 지금 탭·검색에 맞는 전체 인원(페이지 수 계산용)
  page: number; // 1부터
  pageSize: number;
  counts: Record<MemberListFilter, number>; // 탭별 진짜 전체 인원 — 검색과 상관없이
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
  partnerAttendanceId: string | null; // 대회 연습 파트너(그날만) — 게임 추천이 같은 게임에 넣는 쪽으로 가점
  member?: IMember;
}

// 대회 연습 파트너 지정 — 두 사람의 출석 id
export interface ISetPartnerDto {
  attendanceIds: string[];
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
  birthDate?: string; // YYYY-MM-DD — 생략 가능(모르면 비워 두고 나중에 채움, 게스트는 늘 null). 비우면 같은 이름이 있을 때 409
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

// 빈칸 있는 조합(1~3명) — 관제판에서 사람을 한 명씩 끌어다 놓아 짠다. 4명이 차면 일반 조합
// 모임원 앱·코트 배정·빈 코트 채우기는 4명 다 찬 조합만 다룬다
export const GAME_SIZE = 4;

// 새 조합 자리에 첫 사람을 놓기
export interface ICreateDraftGameDto {
  attendanceId: string;
}

// 대기 조합의 빈칸에 한 명 넣기
export interface IAddGamePlayerDto {
  attendanceId: string;
}

// 대기 조합 전체 순서를 한 번에 — 끌어서 놓은 최종 순서(지금 대기 중인 조합 전부)
export interface IReorderGamesDto {
  gameIds: string[];
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
  pinned: boolean; // 운영진이 "이 사람은 꼭 넣어"로 지정한 인원 (AI 명령·고정 추천)
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

// 빈 코트 채우기 결과 — 가능한 것만 배정하고, 못 넣은 조합은 이유와 함께 돌려준다
export interface IFillCourtsResult {
  assigned: { gameId: string; courtNo: number; names: string[] }[];
  skipped: { gameId: string; reason: string }[]; // 예: "김OO 게임 중"
}

// ===== 웹 푸시 (/push/*) =====

// 서버 비활성(VAPID 키 없음)이면 null — 웹은 구독 UI를 숨긴다
export interface IPushPublicKey {
  publicKey: string | null;
}

// 구독 등록 — 브라우저 PushSubscription을 평평하게 펼쳐 보낸다
// (중첩 객체는 ValidationPipe whitelist가 검증 데코레이터 없는 필드를 조용히 지우므로 피한다)
export interface ISubscribePushDto {
  memberId: string;
  endpoint: string;
  p256dh: string; // subscription.toJSON().keys.p256dh
  auth: string; // subscription.toJSON().keys.auth
}

// 구독 해지 — endpoint 자체가 추측 불가능한 값이라 이것으로 소유를 증명한다
export interface IUnsubscribePushDto {
  endpoint: string;
}

// 운영진 호출·다시 알림 결과 — devices가 0이면 알림을 등록하지 않은 사람(직접 불러야 함)
export interface IPushCallResult {
  devices: number;
}

// 서비스워커가 받아 그대로 알림으로 띄우는 내용
export interface IPushPayload {
  title: string;
  body: string;
  tag: string; // 같은 tag의 이전 알림을 대체 — 알림 센터에 쌓이지 않게
  url: string; // 알림을 누르면 열 경로
}

// ===== AI 체크인 (/ai-check-in/*, 운영진 전용) =====

// 서버에 AI 키가 없으면 enabled=false — 웹은 AI 영역을 숨긴다
export interface IAiCheckInStatus {
  enabled: boolean;
}

export interface IAiCheckInMember {
  memberId: string;
  name: string;
}

// 운영진 자연어 명령 — 예: "97년생 김민수 체크인해줘"
export interface IAiCheckInCommandDto {
  text: string;
}

// 캡처·명령 처리 결과 — 확실한 사람만 체크인하고 나머지는 운영진이 직접 처리하도록 나눠서 돌려준다
export interface IAiCheckInResult {
  checkedIn: IAiCheckInMember[]; // 이번에 체크인됨
  alreadyIn: IAiCheckInMember[]; // 이미 출석 중 — 실패가 아니라 정보
  notFound: string[]; // 명단에서 못 찾은 표기(캡처 원문 그대로)
  ambiguous: { name: string; candidates: IMember[] }[]; // 동명이인·이름만 표기 — 후보 버튼으로 운영진이 고른다
  message: string; // 서버가 정해진 틀로 조립한 안내 문장 (AI가 쓴 문장이 아님)
}

// ===== 뒤풀이 정산 =====

// 영수증 품목 분류 — 공통(전원)·술(술 마신 사람)·음료(음료 마신 사람)로 나눠 낸다
export type ReceiptCategory = 'common' | 'alcohol' | 'beverage';

export interface IReceiptItem {
  name: string; // 영수증에 적힌 그대로
  amount: number; // 그 줄의 금액(수량 × 단가), 할인 줄은 음수
  category: ReceiptCategory;
}

// 영수증 AI 판독 결과 — 계산은 웹이 한다(서버는 읽기만)
export interface IReceiptReadResult {
  items: IReceiptItem[];
  total: number | null; // 영수증의 최종 결제 금액(여러 장이면 합계), 못 읽으면 null
}

// ===== AI 운영 명령 (/sessions/:id/ai-command) — 글·음성 명령을 미리보기로 바꿔 준다(실행은 웹이 확인 후) =====

export interface IAiCommandDto {
  text: string;
}

// 미리보기 후 실행하는 동작 — 실행은 기존 API(게임 종료·휴식·복귀·호출)를 그대로 쓴다
export type AiCommandAction = 'make_game' | 'finish_game' | 'rest' | 'resume' | 'call' | 'partner' | 'unpartner';

export interface IAiCommandTarget {
  attendanceId: string;
  name: string;
  detail: string; // 동명이인 구분용 — "C급 · 97년생" / "B급 · 게스트"
}

// 음성 게스트 추가 미리보기 한 줄 — 말한 성별·급수는 미리 채우고, 빠진 것은 운영진이 미리보기에서 고른다
export interface IAiGuestDraft {
  name: string;
  gender: Gender | null;
  grade: Grade | null;
  existingMemberId: string | null; // 같은 이름 게스트가 이미 있으면 새로 만들지 않고 그 사람으로 체크인
  alreadyCheckedIn: boolean; // 오늘 이미 출석 — 할 일 없음
  note: string | null; // "같은 이름의 정회원이 있어요" 등
}

export type IAiCommandResult =
  // 게임 짜기 — 추천 후보(지정 인원은 players[].pinned)
  | { kind: 'game_preview'; category: RecommendationCategory; recommendations: IGameRecommendation[] }
  // 이름이 여러 명과 맞음 — 운영진이 고른 뒤 웹이 이어서 처리(AI 재호출 없음)
  | {
      kind: 'choose';
      action: AiCommandAction;
      category: RecommendationCategory;
      resolved: IAiCommandTarget[];
      unresolved: { name: string; candidates: IAiCommandTarget[] }[];
    }
  // 게임 종료·휴식·복귀·호출 — 대상과 문장을 보여 주고 확인 후 실행
  | {
      kind: 'action_preview';
      action: Exclude<AiCommandAction, 'make_game'>;
      label: string; // "3번 코트 게임 종료 — 김민수, 이준호, …"
      gameId: string | null; // finish_game일 때
      targets: IAiCommandTarget[];
    }
  // 체크인 — 기존 AI 체크인 규칙 그대로(확실한 사람만 바로 체크인, 결과 카드에서 취소 가능)
  | { kind: 'check_in'; result: IAiCheckInResult }
  // 안내만(못 찾음·지원 안 함·못 알아들음) — 문구는 서버 고정, AI가 쓴 문장이 아니다
  | { kind: 'message'; text: string }
  // 질문 답("누가 제일 오래 기다렸어?") — 숫자·문장 모두 서버가 실시간 현황에서 만든다(AI는 질문 종류만 고름)
  | { kind: 'answer'; title: string; lines: string[] }
  // 게스트 추가 — 확인하면 웹이 기존 등록·수동 체크인 API로 실행(콕 확인은 따로)
  | { kind: 'guest_preview'; guests: IAiGuestDraft[] }
  // 한 문장에 여러 명령("3번 코트 끝났고 남복 하나 짜줘") — 웹이 말한 순서대로 하나씩 보여 준다(최대 3개)
  | { kind: 'multi'; steps: IAiCommandStep[] };

// 여러 명령의 한 단계 — multi는 다시 들어가지 않는다
export type IAiCommandStep = Exclude<IAiCommandResult, { kind: 'multi' }>;

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
