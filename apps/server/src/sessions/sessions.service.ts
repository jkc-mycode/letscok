import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ISession, ISessionSnapshot } from '@letscok/shared-types';
import { toSessionResponse } from '../common/mappers/entity.mappers';
import { generateCheckInCode } from '../common/utils/code.util';
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
    // 코드는 재발급하지 않음 — 현장에 이미 띄운 QR·이미 체크인한 인원과의 연속성 유지
    const today = todayKst();
    const closedToday = await this.prisma.session.findFirst({
      where: { date: today, status: 'CLOSED' },
    });
    if (closedToday) {
      const reopened = await this.prisma.session.update({
        where: { id: closedToday.id },
        data: {
          status: 'OPEN',
          closedAt: null,
          // 과거(코드 도입 전) 세션을 재개하면 코드가 없으므로 이때 보충 발급
          ...(closedToday.checkInCode ? {} : { checkInCode: generateCheckInCode() }),
        },
      });
      this.realtime.broadcastSnapshot(reopened.id); // 종료 화면을 보던 클라이언트 복귀용
      return toSessionResponse(reopened);
    }

    // 코드 승계 — 운영진이 정한 코드(0000 등)가 모임마다 초기화되면 매번 다시 설정해야 한다
    // 고정 코드라야 QR을 한 번 인쇄해 붙여두고 계속 쓸 수 있다
    const previous = await this.prisma.session.findFirst({
      where: { checkInCode: { not: null } },
      orderBy: { date: 'desc' },
      select: { checkInCode: true },
    });
    const session = await this.prisma.session.create({
      data: {
        date: today,
        checkInCode: previous?.checkInCode ?? generateCheckInCode(),
      },
    });
    return toSessionResponse(session);
  }

  // 체크인 코드 변경 (운영진 전용) — 0000·1234처럼 부르기 쉬운 값을 쓸 수 있게
  // 코드는 실질 방어선이 아니다(콕 확인이 게이트). 유출돼도 게임 배정은 운영진 손을 거친다
  async updateCheckInCode(code: string): Promise<string> {
    const session = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('아직 모임이 시작되지 않았습니다.');
    }

    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: { checkInCode: code },
    });
    return updated.checkInCode as string;
  }

  // 모임 종료 = 그날 운영 마감 — 보드를 통째로 정리한다
  // 실수 종료 대비: 같은 날 재시작하면 세션이 재개되고, 재체크인 시 기존 출석 행으로
  // 복귀(gamesPlayed 보존)하므로 여기서 전부 정리해도 안전
  async close(id: string): Promise<ISession> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.status !== 'OPEN') {
      throw new NotFoundException('진행 중인 모임이 아닙니다.');
    }

    const now = new Date();
    const [, , , closed] = await this.prisma.$transaction([
      // 미완료 게임은 집계 없이 해체 (FINISHED가 아니므로 게임 수 영향 없음)
      this.prisma.game.updateMany({
        where: { sessionId: id, status: { in: ['QUEUED', 'PLAYING'] } },
        data: { status: 'CANCELED', queueOrder: null },
      }),
      // 남아 있는 인원 전원 퇴장 처리
      this.prisma.attendance.updateMany({
        where: { sessionId: id, status: { not: 'LEFT' } },
        data: { status: 'LEFT', leftAt: now },
      }),
      // 코트 전부 해제 (재시작 시 다시 등록 — 같은 번호면 기존 행 복구됨)
      this.prisma.court.updateMany({
        where: { sessionId: id, deletedAt: null },
        data: { status: 'IDLE', deletedAt: now },
      }),
      this.prisma.session.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: now },
      }),
    ]);
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

  // 운영진 전용 — 진행 중 세션의 현장 체크인 코드 (QR 렌더용)
  // 공개 스냅샷엔 코드를 안 싣기 때문에 코드가 필요한 관제판은 이 경로로만 얻는다
  async getCurrentCheckInCode(): Promise<string | null> {
    const session = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
      select: { checkInCode: true },
    });
    if (!session) {
      throw new NotFoundException('아직 모임이 시작되지 않았습니다.');
    }
    return session.checkInCode;
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
