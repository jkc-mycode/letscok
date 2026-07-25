import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ICourt } from '@letscok/shared-types';
import { toCourtResponse } from '../common/mappers/entity.mappers';
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

    // 같은 번호가 이미 있으면: 해제됐던 코트는 복구, 사용 중이면 중복 에러
    // (@@unique([sessionId, courtNo]) 제약 때문에 soft-delete 행도 새로 만들 수 없음)
    const existing = await this.prisma.court.findUnique({
      where: { sessionId_courtNo: { sessionId, courtNo: dto.courtNo } },
    });
    if (existing) {
      if (!existing.deletedAt) {
        throw new ConflictException('이미 등록된 코트 번호입니다.');
      }
      // 공유 상태는 그날 상황이라 승계하지 않는다 — 재등록은 새 코트처럼 초기화
      const restored = await this.prisma.court.update({
        where: { id: existing.id },
        data: { deletedAt: null, status: 'IDLE', isShared: false, ourTurn: true },
      });
      this.realtime.broadcastSnapshot(sessionId);
      return toCourtResponse(restored);
    }

    const court = await this.prisma.court.create({
      data: { sessionId, courtNo: dto.courtNo },
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
