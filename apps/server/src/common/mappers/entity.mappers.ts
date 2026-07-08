import {
  IAttendance,
  ICourt,
  IGame,
  IGamePlayer,
  IMember,
  ISession,
} from '@letscok/shared-types';
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

export function toMemberResponse(member: Member): IMember {
  return {
    id: member.id,
    name: member.name,
    birthDate: toDateString(member.birthDate),
    grade: member.grade,
    gender: member.gender,
    isGuest: member.isGuest,
    createdAt: member.createdAt.toISOString(),
  };
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

export function toCourtResponse(court: Court): ICourt {
  return {
    id: court.id,
    sessionId: court.sessionId,
    courtNo: court.courtNo,
    status: court.status,
  };
}

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
    ...(attendance.member && { member: toMemberResponse(attendance.member) }),
  };
}

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
    ...(game.players && {
      players: game.players.map(
        (player): IGamePlayer => ({
          id: player.id,
          gameId: player.gameId,
          attendanceId: player.attendanceId,
          ...(player.attendance && {
            attendance: toAttendanceResponse(player.attendance),
          }),
        }),
      ),
    }),
  };
}
