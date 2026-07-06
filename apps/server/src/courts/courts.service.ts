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
      const restored = await this.prisma.court.update({
        where: { id: existing.id },
        data: { deletedAt: null, status: 'IDLE' },
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

  async remove(id: string): Promise<ICourt> {
    const court = await this.prisma.court.findFirst({
      where: { id, deletedAt: null },
    });
    if (!court) {
      throw new NotFoundException('등록된 코트를 찾을 수 없습니다.');
    }
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
