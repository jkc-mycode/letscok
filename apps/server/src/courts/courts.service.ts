import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ICourt } from '@letscok/shared-types';
import { toCourtResponse } from '../common/mappers/entity.mappers';
import { lockKey } from '../common/utils/lock.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CreateCourtDto } from './dto/create-court.dto';

@Injectable()
export class CourtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly realtime: RealtimeService,
  ) {}

  async register(sessionId: string, dto: CreateCourtDto): Promise<ICourt> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const court = await this.prisma.$transaction(async (tx) => {
      // 같은 번호 추가를 한 줄로 — 두 관제판(여복·남복)이 동시에 같은 번호를 넣으면 둘 다 검사를 통과하던 틈
      await lockKey(tx, `court:${dto.courtNo}`);
      await this.assertNotUsedByOtherSession(tx, sessionId, dto.courtNo);

      // 같은 번호가 이미 있으면: 해제됐던 코트는 복구, 사용 중이면 중복 에러
      // (@@unique([sessionId, courtNo]) 제약 때문에 soft-delete 행도 새로 만들 수 없음)
      const existing = await tx.court.findUnique({
        where: { sessionId_courtNo: { sessionId, courtNo: dto.courtNo } },
      });
      if (existing) {
        if (!existing.deletedAt) {
          throw new ConflictException('이미 등록된 코트 번호입니다.');
        }
        // 공유 상태는 그날 상황이라 승계하지 않는다 — 재등록은 새 코트처럼 초기화
        return tx.court.update({
          where: { id: existing.id },
          data: { deletedAt: null, status: 'IDLE', isShared: false, ourTurn: true },
        });
      }

      return tx.court.create({
        data: { sessionId, courtNo: dto.courtNo },
      });
    });
    this.realtime.broadcastSnapshot(sessionId);
    return toCourtResponse(court);
  }

  // 공유 코트 지정/해제 — 다른 모임과 콕 걸고 번갈아 쓰는 코트 (체육관 불문율)
  // 게임 중에도 바꿀 수 있다: 치는 도중 상대 모임이 콕을 걸어 공유가 시작되는 경우가 흔함
  async setShared(id: string, isShared: boolean): Promise<ICourt> {
    const court = await this.findCourtOrThrow(id);
    const updated = await this.prisma.court.update({
      where: { id: court.id },
      // 해제 시 차례도 우리로 리셋 — 남은 ourTurn=false가 배정을 계속 막지 않게
      data: { isShared, ...(isShared ? {} : { ourTurn: true }) },
    });
    this.realtime.broadcastSnapshot(court.sessionId);
    return toCourtResponse(updated);
  }

  // 공유 코트 차례 변경 — 상대 게임이 끝나면 운영진이 우리 차례로 되돌린다
  // (상대 게임 종료는 앱이 알 수 없어 이 한 번의 탭이 필요하다. 우리→상대는 게임 종료 시 자동)
  async setTurn(id: string, ourTurn: boolean): Promise<ICourt> {
    const court = await this.findCourtOrThrow(id);
    if (!court.isShared) {
      throw new ConflictException('공유 코트가 아닙니다.');
    }
    const updated = await this.prisma.court.update({
      where: { id: court.id },
      data: { ourTurn },
    });
    this.realtime.broadcastSnapshot(court.sessionId);
    return toCourtResponse(updated);
  }

  // 번호 바꾸기 — 잘못 등록한 번호를 고칠 때. 게임 중이어도 된다(끝난 게임 기록도 코트로 이어져 새 번호로 보인다)
  // 다른 코트가 쓰는 번호면 막는다(맞바꾸기는 한쪽을 잠깐 다른 번호로 옮겨서)
  async renumber(id: string, dto: CreateCourtDto): Promise<ICourt> {
    const court = await this.findCourtOrThrow(id);
    await this.sessionsService.findOpenSessionOrThrow(court.sessionId);
    if (court.courtNo === dto.courtNo) return toCourtResponse(court);

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockKey(tx, `court:${dto.courtNo}`); // 코트 추가와 같은 줄 — 다른 모임이 같은 번호를 동시에 잡지 않게
      await this.assertNotUsedByOtherSession(tx, court.sessionId, dto.courtNo);
      // 해제된 코트도 고유 제약상 번호를 쥐고 있다 — 기록이 없으면 지우고, 있으면 그 기록의 번호가 바뀌면 안 되니 막는다
      const holder = await tx.court.findUnique({
        where: { sessionId_courtNo: { sessionId: court.sessionId, courtNo: dto.courtNo } },
      });
      if (holder && !holder.deletedAt) {
        throw new ConflictException(`이미 ${dto.courtNo}번 코트가 있어요.`);
      }
      if (holder) {
        if ((await tx.game.count({ where: { courtId: holder.id } })) > 0) {
          throw new ConflictException(
            `오늘 ${dto.courtNo}번 코트에서 한 게임 기록이 남아 있어 이 번호로 바꿀 수 없어요. [코트 추가]로 ${dto.courtNo}번을 다시 쓰세요.`,
          );
        }
        await tx.court.delete({ where: { id: holder.id } });
      }
      return tx.court.update({ where: { id: court.id }, data: { courtNo: dto.courtNo } });
    });
    this.realtime.broadcastSnapshot(court.sessionId);
    return toCourtResponse(updated);
  }

  // 여복·남복처럼 같은 체육관에서 동시에 연 모임 — 한 코트를 두 보드가 같이 배정하지 않게
  private async assertNotUsedByOtherSession(tx: Prisma.TransactionClient, sessionId: string, courtNo: number) {
    const other = await tx.court.findFirst({
      where: { courtNo, deletedAt: null, sessionId: { not: sessionId }, session: { status: 'OPEN' } },
      select: { session: { select: { label: true } } },
    });
    if (other) {
      const where = other.session.label ? `'${other.session.label}'` : '다른';
      throw new ConflictException(`${courtNo}번 코트는 ${where} 모임이 쓰고 있어요.`);
    }
  }

  private async findCourtOrThrow(id: string) {
    const court = await this.prisma.court.findFirst({
      where: { id, deletedAt: null },
    });
    if (!court) {
      throw new NotFoundException('등록된 코트를 찾을 수 없습니다.');
    }
    return court;
  }

  async remove(id: string): Promise<ICourt> {
    const court = await this.findCourtOrThrow(id);
    if (court.status === 'IN_GAME') {
      throw new ConflictException(
        '게임 진행 중인 코트는 해제할 수 없습니다. 게임 종료 후 해제해주세요.',
      );
    }

    const removed = await this.prisma.court.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.realtime.broadcastSnapshot(court.sessionId);
    return toCourtResponse(removed);
  }
}
