import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ISession, ISessionSnapshot } from '@letscok/shared-types';
import {
  toAttendanceResponse,
  toCourtResponse,
  toGameResponse,
  toSessionResponse,
} from '../common/mappers/entity.mappers';
import { todayKst } from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async open(): Promise<ISession> {
    // 동시 세션 없음 확정 — OPEN이 하나라도 있으면 새로 열 수 없다
    const openSession = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
    });
    if (openSession) {
      throw new ConflictException('이미 진행 중인 모임이 있습니다.');
    }

    // 같은 날 종료했던 세션이 있으면 새로 만들지 않고 재개
    // (실수로 종료한 경우 출석·게임 횟수가 초기화되지 않도록)
    const today = todayKst();
    const closedToday = await this.prisma.session.findFirst({
      where: { date: today, status: 'CLOSED' },
    });
    if (closedToday) {
      const reopened = await this.prisma.session.update({
        where: { id: closedToday.id },
        data: { status: 'OPEN', closedAt: null },
      });
      return toSessionResponse(reopened);
    }

    const session = await this.prisma.session.create({
      data: { date: today },
    });
    return toSessionResponse(session);
  }

  async close(id: string): Promise<ISession> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.status !== 'OPEN') {
      throw new NotFoundException('진행 중인 모임이 아닙니다.');
    }
    // TODO(게임 기능 구현 시): PLAYING 게임이 남아 있으면 종료를 막거나 일괄 정리
    const closed = await this.prisma.session.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    return toSessionResponse(closed);
  }

  // 진행 중 세션 + 보드 렌더링에 필요한 전체 데이터 — 첫 진입과 소켓 재연결 시 사용
  async getCurrentSnapshot(): Promise<ISessionSnapshot> {
    const session = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('아직 모임이 시작되지 않았습니다.');
    }

    // 스냅샷 구성 요소를 한 번에 조회 (순차 대기 없이 병렬)
    const [courts, attendances, games] = await Promise.all([
      this.prisma.court.findMany({
        where: { sessionId: session.id, deletedAt: null }, // 해제된 코트는 보드에서 제외
        orderBy: { courtNo: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { sessionId: session.id },
        include: { member: true },
        orderBy: { waitingSince: 'asc' }, // 대기 구역은 오래 기다린 순
      }),
      this.prisma.game.findMany({
        // FINISHED/CANCELED는 보드에 안 보이므로 제외 (게임 수는 attendance.gamesPlayed로 충분)
        where: { sessionId: session.id, status: { in: ['QUEUED', 'PLAYING'] } },
        include: { players: { include: { attendance: { include: { member: true } } } } },
        orderBy: { queueOrder: 'asc' },
      }),
    ]);

    return {
      session: toSessionResponse(session),
      courts: courts.map(toCourtResponse),
      attendances: attendances.map(toAttendanceResponse),
      games: games.map(toGameResponse),
    };
  }

  // 다른 모듈(체크인 등)에서 "진행 중 세션" 존재 검증용
  async findOpenSessionOrThrow(id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.status !== 'OPEN') {
      throw new NotFoundException('진행 중인 모임이 아닙니다.');
    }
    return session;
  }
}
