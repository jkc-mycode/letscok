import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IClosedTodaySession, ISession, ISessionSnapshot } from '@letscok/shared-types';
import { toSessionResponse } from '../common/mappers/entity.mappers';
import { generateCheckInCode } from '../common/utils/code.util';
import { todayKst } from '../common/utils/date.util';
import { lockKey } from '../common/utils/lock.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const OPEN_LOCK = 'session-open'; // 모임 열기·체크인 코드 변경이 함께 쓰는 잠금 키

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // 오늘 마지막으로 종료한 모임 — 같은 날 두 번째 모임이 있으면 그중 늦게 끝난 것
  private findLastClosedToday(db: Prisma.TransactionClient = this.prisma) {
    return db.session.findFirst({
      where: { date: todayKst(), status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
    });
  }

  // 관제판이 [모임 시작] 전에 묻는다 — 있으면 [이어서 하기]/[새 모임] 고르는 창
  async getClosedToday(): Promise<IClosedTodaySession | null> {
    const last = await this.findLastClosedToday();
    if (!last) return null;
    const [attendeeCount, sessionCountToday] = await Promise.all([
      this.prisma.attendance.count({ where: { sessionId: last.id } }),
      this.prisma.session.count({ where: { date: last.date } }),
    ]);
    return { session: toSessionResponse(last), attendeeCount, sessionCountToday };
  }

  // fresh: 같은 날 종료한 모임이 있어도 새 모임으로 시작 (장소·모임원이 다른 두 번째 모임)
  // label: 여복·남복처럼 같은 체육관에서 코트를 나눠 동시에 여는 모임 — 열린 모임이 있으면 이름이 있어야 같이 연다
  async open(fresh = false, rawLabel?: string): Promise<ISession> {
    const label = rawLabel?.trim() || null;
    const result = await this.prisma.$transaction(async (tx) => {
      // 모임 열기를 한 줄로 — [모임 시작]을 빠르게 두 번 누르면 둘 다 '열린 모임 없음'을 보고 이름 없는 모임을 둘 만들던 틈
      await lockKey(tx, OPEN_LOCK);
      const openSessions = await tx.session.findMany({
        where: { status: 'OPEN' },
        select: { label: true },
      });
      if (openSessions.length > 0) {
        // 이름 없이 누른 [모임 시작]은 실수로 두 번 누른 것일 수 있다 — 동시 진행은 이름을 정해야만
        if (!label) {
          throw new ConflictException('이미 진행 중인 모임이 있습니다.');
        }
        if (openSessions.some((s) => s.label === label)) {
          throw new ConflictException(`'${label}' 모임이 이미 열려 있어요. 다른 이름을 정해주세요.`);
        }
      }

      // 같은 날 종료했던 세션이 있으면 새로 만들지 않고 재개
      // (실수로 종료한 경우 출석·게임 횟수가 초기화되지 않도록)
      // 코드는 재발급하지 않음 — 이미 공지한 코드·체크인한 인원과의 연속성 유지
      // 다른 모임과 같이 여는 건 늘 새 모임 — 끝낸 모임을 잘못 되살리지 않게
      const closedToday = fresh || openSessions.length > 0 ? null : await this.findLastClosedToday(tx);
      if (closedToday) {
        const reopened = await tx.session.update({
          where: { id: closedToday.id },
          data: {
            status: 'OPEN',
            closedAt: null,
            ...(label && { label }),
            // 과거(코드 도입 전) 세션을 재개하면 코드가 없으므로 이때 보충 발급
            ...(closedToday.checkInCode ? {} : { checkInCode: generateCheckInCode() }),
          },
        });
        return { session: reopened, reopened: true, alongside: false };
      }

      // 코드 승계 — 운영진이 정한 코드가 모임마다 초기화되면 매번 다시 설정해야 한다
      // 공지사항 작성월일을 쓰는 운영이라 공지가 바뀔 때만 관제판에서 바꾼다. 동시에 여는 모임도 같은 코드
      const previous = await tx.session.findFirst({
        where: { checkInCode: { not: null } },
        orderBy: [{ date: 'desc' }, { openedAt: 'desc' }],
        select: { checkInCode: true },
      });
      const session = await tx.session.create({
        data: {
          date: todayKst(),
          label,
          checkInCode: previous?.checkInCode ?? generateCheckInCode(),
        },
      });
      return { session, reopened: false, alongside: openSessions.length > 0 };
    });

    if (result.reopened) this.realtime.broadcastSnapshot(result.session.id); // 종료 화면을 보던 클라이언트 복귀용
    if (result.alongside) void this.realtime.broadcastOpenSessions(); // 먼저 연 모임 화면에 전환 칩이 생기게
    return toSessionResponse(result.session);
  }

  // 모임 이름 바꾸기 (운영진 전용) — 먼저 연 모임은 보통 이름 없이 시작하니 두 번째를 열 때 같이 정한다
  async updateLabel(id: string, rawLabel: string): Promise<ISession> {
    await this.findOpenSessionOrThrow(id);
    const label = rawLabel.trim() || null;
    if (label) {
      const same = await this.prisma.session.findFirst({
        where: { status: 'OPEN', label, id: { not: id } },
        select: { id: true },
      });
      if (same) {
        throw new ConflictException(`'${label}' 모임이 이미 열려 있어요. 다른 이름을 정해주세요.`);
      }
    }
    const updated = await this.prisma.session.update({ where: { id }, data: { label } });
    void this.realtime.broadcastOpenSessions();
    return toSessionResponse(updated);
  }

  // 체크인 코드 변경 (운영진 전용) — 소모임 공지사항 작성월일(MMDD)로 맞춰 쓴다
  // 코드는 실질 방어선이 아니다(콕 확인이 게이트). 유출돼도 게임 배정은 운영진 손을 거친다
  // 공지는 하나라 동시에 연 모임(여복·남복)도 같은 코드 — 열린 모임 전부를 바꾼다
  async updateCheckInCode(code: string): Promise<string> {
    // 모임 열기와 같은 줄 — 새 모임이 옛 코드를 승계하는 사이 코드가 바뀌어 두 모임 코드가 갈리지 않게
    const { count } = await this.prisma.$transaction(async (tx) => {
      await lockKey(tx, OPEN_LOCK);
      return tx.session.updateMany({
        where: { status: 'OPEN' },
        data: { checkInCode: code },
      });
    });
    if (count === 0) {
      throw new NotFoundException('아직 모임이 시작되지 않았습니다.');
    }
    return code;
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
    void this.realtime.broadcastOpenSessions(); // 남은 모임 화면에서 전환 칩을 지운다
    return toSessionResponse(closed);
  }

  // 진행 중 세션 스냅샷 — 빌더는 소켓 브로드캐스트와 공유 (realtime.service 참조)
  // 동시에 연 모임이 있으면 고르는 순서: 화면이 고른 모임(id) → 그 사람이 출석 중인 모임(memberId) → 먼저 연 모임
  // 아무것도 안 보내는 옛 화면은 먼저 연 모임을 받는다(모임이 하나면 지금과 같다)
  async getCurrentSnapshot(prefer: { id?: string; memberId?: string } = {}): Promise<ISessionSnapshot> {
    const open = await this.prisma.session.findMany({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      select: { id: true },
    });
    if (open.length === 0) {
      throw new NotFoundException('아직 모임이 시작되지 않았습니다.');
    }
    let targetId = open.find((s) => s.id === prefer.id)?.id;
    if (!targetId && prefer.memberId && open.length > 1) {
      const mine = await this.prisma.attendance.findFirst({
        where: {
          memberId: prefer.memberId,
          status: { not: 'LEFT' },
          sessionId: { in: open.map((s) => s.id) },
        },
        select: { sessionId: true },
      });
      targetId = mine?.sessionId;
    }
    return this.realtime.buildSnapshot(targetId ?? open[0].id);
  }

  // 운영진 전용 — 진행 중 세션의 체크인 코드 (관제판 표시·변경용)
  // 공개 스냅샷엔 코드를 안 싣기 때문에 코드가 필요한 관제판은 이 경로로만 얻는다. 동시에 연 모임도 코드는 같다
  async getCurrentCheckInCode(): Promise<string | null> {
    const session = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
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
