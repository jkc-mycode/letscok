import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ISessionSnapshot } from '@letscok/shared-types';
import {
  toAttendanceResponse,
  toCourtResponse,
  toGameResponse,
  toSessionResponse,
} from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
  ) {}

  // 보드 렌더링에 필요한 전체 데이터 — REST(GET /sessions/current)와
  // 소켓 브로드캐스트가 같은 빌더를 쓰므로 두 경로의 데이터가 항상 동일하다
  async buildSnapshot(sessionId: string): Promise<ISessionSnapshot> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('모임을 찾을 수 없습니다.');
    }

    // 스냅샷 구성 요소를 한 번에 조회 (순차 대기 없이 병렬)
    const [courts, attendances, games] = await Promise.all([
      this.prisma.court.findMany({
        where: { sessionId, deletedAt: null }, // 해제된 코트는 보드에서 제외
        orderBy: { courtNo: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { sessionId },
        include: { member: true },
        orderBy: { waitingSince: 'asc' }, // 대기 구역은 오래 기다린 순
      }),
      this.prisma.game.findMany({
        // FINISHED/CANCELED는 보드에 안 보이므로 제외 (게임 수는 attendance.gamesPlayed로 충분)
        where: { sessionId, status: { in: ['QUEUED', 'PLAYING'] } },
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

  // 변경을 일으킨 서비스가 응답을 지연시키지 않도록 fire-and-forget으로 호출한다
  // (브로드캐스트 실패는 로그만 — 이미 커밋된 변경의 응답을 실패시키면 안 됨)
  broadcastSnapshot(sessionId: string): void {
    this.buildSnapshot(sessionId)
      .then((snapshot) => this.gateway.emitSnapshotUpdated(sessionId, snapshot))
      .catch((error: Error) =>
        this.logger.error(`스냅샷 브로드캐스트 실패 (session=${sessionId})`, error.stack),
      );
  }

  broadcastSessionClosed(sessionId: string): void {
    this.gateway.emitSessionClosed(sessionId);
  }
}
