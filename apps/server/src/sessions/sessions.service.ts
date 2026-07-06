import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ISession, ISessionSnapshot } from '@letscok/shared-types';
import { toSessionResponse } from '../common/mappers/entity.mappers';
import { todayKst } from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

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
      this.realtime.broadcastSnapshot(reopened.id); // 종료 화면을 보던 클라이언트 복귀용
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
    // TODO(운영 화면 붙일 때): PLAYING 게임이 남아 있으면 종료를 막거나 일괄 정리
    const closed = await this.prisma.session.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    this.realtime.broadcastSessionClosed(id);
    return toSessionResponse(closed);
  }

  // 진행 중 세션 스냅샷 — 빌더는 소켓 브로드캐스트와 공유 (realtime.service 참조)
  async getCurrentSnapshot(): Promise<ISessionSnapshot> {
    const session = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('아직 모임이 시작되지 않았습니다.');
    }
    return this.realtime.buildSnapshot(session.id);
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
