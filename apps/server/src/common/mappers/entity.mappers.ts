import {
  IAttendance,
  ICourt,
  IGame,
  IGamePlayer,
  IMember,
  ISession,
} from '@letscok/shared-types';
import { withSlots } from '../utils/game-slots';
import {
  Attendance,
  Court,
  Game,
  GamePlayer,
  Member,
  Session,
} from '../../generated/prisma/client';
import { toDateString } from '../utils/date.util';

// Prisma 엔티티 → 공유 타입 응답 변환 모음
// Date는 전부 ISO 문자열로 정규화 — 클라이언트가 타임존 계산(경과 시간 타이머)에 그대로 사용

// 회원 원장 → 응답. gender는 미지정(도입 전 회원)이면 null 그대로 내려간다
export function toMemberResponse(member: Member): IMember {
  return {
    id: member.id,
    name: member.name,
    birthDate: member.birthDate ? toDateString(member.birthDate) : null, // 게스트는 null
    birthYear: member.birthDate ? member.birthDate.getUTCFullYear() : null,
    grade: member.grade,
    gender: member.gender,
    isGuest: member.isGuest,
    role: member.role,
    consented: member.consentedAt !== null, // 시각 자체는 불필요 — 웹은 동의 화면 노출 여부만 판단
    createdAt: member.createdAt.toISOString(),
  };
}

// 세션 → 응답. date는 날짜만(YYYY-MM-DD), opened/closedAt은 시각까지 ISO로
// 패스코드 없이 나가는 응답용 — 생년월일은 개인정보라 연도만 남긴다(동명이인 구분엔 충분)
// 보드(스냅샷·소켓)는 누구나 받으므로 출석·게임 안의 회원은 항상 이 모양
export function toPublicMemberResponse(member: Member): IMember {
  return { ...toMemberResponse(member), birthDate: null };
}

export function toSessionResponse(session: Session): ISession {
  return {
    id: session.id,
    date: toDateString(session.date),
    status: session.status,
    openedAt: session.openedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
  };
}

// 코트 → 응답. deletedAt(soft-delete)은 응답에서 제외 — 보드엔 살아있는 코트만 노출
export function toCourtResponse(court: Court): ICourt {
  return {
    id: court.id,
    sessionId: court.sessionId,
    courtNo: court.courtNo,
    status: court.status,
    isShared: court.isShared,
    ourTurn: court.ourTurn,
  };
}

// 출석 → 응답. member는 관계까지 include한 조회(스냅샷·검색)일 때만 실려 오므로 선택적으로 매핑
export function toAttendanceResponse(
  attendance: Attendance & { member?: Member },
): IAttendance {
  return {
    id: attendance.id,
    sessionId: attendance.sessionId,
    memberId: attendance.memberId,
    status: attendance.status,
    checkedInAt: attendance.checkedInAt.toISOString(),
    waitingSince: attendance.waitingSince.toISOString(),
    gamesPlayed: attendance.gamesPlayed,
    leftAt: attendance.leftAt?.toISOString() ?? null,
    shuttleConfirmedAt: attendance.shuttleConfirmedAt?.toISOString() ?? null,
    partnerAttendanceId: attendance.partnerAttendanceId,
    ...(attendance.member && { member: toPublicMemberResponse(attendance.member) }),
  };
}

// 게임 → 응답. players·attendance·member는 include 깊이에 따라 선택적 — 있을 때만 중첩 매핑
export function toGameResponse(
  game: Game & { players?: (GamePlayer & { attendance?: Attendance & { member?: Member } })[] },
): IGame {
  return {
    id: game.id,
    sessionId: game.sessionId,
    courtId: game.courtId,
    status: game.status,
    queuedAt: game.queuedAt.toISOString(),
    startedAt: game.startedAt?.toISOString() ?? null,
    endedAt: game.endedAt?.toISOString() ?? null,
    queueOrder: game.queueOrder,
    // 자리 순으로 — 비어 있는 자리(도입 전 데이터)는 들어온 순서로 채워 본다
    ...(game.players && {
      players: withSlots(game.players).map(
        (player): IGamePlayer => ({
          id: player.id,
          gameId: player.gameId,
          attendanceId: player.attendanceId,
          slot: player.slot,
          ...(player.attendance && {
            attendance: toAttendanceResponse(player.attendance),
          }),
        }),
      ),
    }),
  };
}
