import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { IAttendance, ISessionSnapshot } from '@letscok/shared-types';
import {
  toAttendanceResponse,
  toCourtResponse,
  toGameResponse,
  toSessionResponse,
} from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

// 이 시간 안의 변경은 모아서 현황을 한 번만 보낸다 — [모두 콕 확인] 20명이면 현황 20번(폰 20대면 400번) → 1번
const BROADCAST_DEBOUNCE_MS = 100;

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>(); // 모임별 보낼 예정

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
    const [courts, attendances, games, openSessions] = await Promise.all([
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
      // 여복·남복처럼 동시에 연 모임 — 화면 위쪽 전환 칩용
      this.prisma.session.findMany({
        where: { status: 'OPEN' },
        orderBy: { openedAt: 'asc' },
        select: { id: true, label: true },
      }),
    ]);

    // 현황은 누구나 받는다 — 출생 연도는 이 모임에 같은 이름이 있는 사람만(동명이인 꼬리표용)
    const seen = new Set<string>();
    const sameNames = new Set<string>();
    for (const a of attendances) (seen.has(a.member.name) ? sameNames : seen).add(a.member.name);
    const hideYear = (a: IAttendance): IAttendance =>
      a.member && !sameNames.has(a.member.name) ? { ...a, member: { ...a.member, birthYear: null } } : a;

    return {
      session: toSessionResponse(session),
      openSessions,
      courts: courts.map(toCourtResponse),
      attendances: attendances.map((a) => hideYear(toAttendanceResponse(a))),
      games: games.map((g) => {
        const game = toGameResponse(g);
        return {
          ...game,
          players: game.players?.map((p) => (p.attendance ? { ...p, attendance: hideYear(p.attendance) } : p)),
        };
      }),
    };
  }

  // 운영 메모가 바뀌었다는 신호만 — 메모는 현황에 없어서 현황 전체를 다시 만들어 보낼 필요가 없다
  notifyMemosChanged(sessionId: string): void {
    this.gateway.emitMemosChanged(sessionId);
  }

  // 변경을 일으킨 서비스가 응답을 지연시키지 않도록 fire-and-forget으로 호출한다
  // (브로드캐스트 실패는 로그만 — 이미 커밋된 변경의 응답을 실패시키면 안 됨)
  // 이미 보낼 예정이면 그대로 둔다 — 보낼 때 그 시점의 현황을 새로 읽으므로 사이의 변경이 다 들어간다
  broadcastSnapshot(sessionId: string): void {
    if (this.pending.has(sessionId)) return;
    this.pending.set(
      sessionId,
      setTimeout(() => {
        this.pending.delete(sessionId);
        this.buildSnapshot(sessionId)
          .then((snapshot) => this.gateway.emitSnapshotUpdated(sessionId, snapshot))
          .catch((error: Error) =>
            this.logger.error(`스냅샷 브로드캐스트 실패 (session=${sessionId})`, error.stack),
          );
      }, BROADCAST_DEBOUNCE_MS),
    );
  }

  // 모임을 열거나 닫거나 이름을 바꾸면 다른 모임 화면의 전환 칩도 바뀌어야 한다 — 열린 모임 전부에 현황을 다시 보낸다
  async broadcastOpenSessions(): Promise<void> {
    const open = await this.prisma.session.findMany({ where: { status: 'OPEN' }, select: { id: true } });
    for (const { id } of open) this.broadcastSnapshot(id);
  }

  // 보낼 예정이던 현황은 버린다 — 종료 알림 뒤에 현황이 도착하면 폰이 종료 화면에서 보드로 되돌아간다
  broadcastSessionClosed(sessionId: string): void {
    const timer = this.pending.get(sessionId);
    if (timer) clearTimeout(timer);
    this.pending.delete(sessionId);
    this.gateway.emitSessionClosed(sessionId);
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}
