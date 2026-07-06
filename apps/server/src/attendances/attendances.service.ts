import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IAttendance } from '@letscok/shared-types';
import { toAttendanceResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class AttendancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {}

  async checkIn(sessionId: string, dto: CheckInDto): Promise<IAttendance> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const member = await this.prisma.member.findFirst({
      where: { id: dto.memberId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('등록되지 않은 모임원입니다.');
    }

    const existing = await this.prisma.attendance.findUnique({
      where: { sessionId_memberId: { sessionId, memberId: dto.memberId } },
      include: { member: true },
    });

    // 첫 체크인
    if (!existing) {
      const attendance = await this.prisma.attendance.create({
        data: { sessionId, memberId: dto.memberId },
        include: { member: true },
      });
      return toAttendanceResponse(attendance);
    }

    // 재입장 (확정 정책): 새 행을 만들지 않고 기존 출석을 대기로 복귀
    // gamesPlayed는 하루 누적이므로 그대로 유지, 대기 시간만 새로 시작
    if (existing.status === 'LEFT') {
      const reentered = await this.prisma.attendance.update({
        where: { id: existing.id },
        data: { status: 'CHECKED_IN', waitingSince: new Date(), leftAt: null },
        include: { member: true },
      });
      return toAttendanceResponse(reentered);
    }

    throw new ConflictException('이미 출석 처리된 모임원입니다.');
  }

  async leave(id: string): Promise<IAttendance> {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
    });
    if (!attendance) {
      throw new NotFoundException('출석 정보를 찾을 수 없습니다.');
    }
    if (attendance.status === 'LEFT') {
      throw new ConflictException('이미 퇴장 처리된 모임원입니다.');
    }
    // 조합·게임에 묶인 채 퇴장하면 보드에 유령 인원이 남는다 — 조합 해체/게임 종료가 먼저
    if (attendance.status === 'MATCHED' || attendance.status === 'PLAYING') {
      throw new ConflictException(
        '게임에 배정된 모임원입니다. 조합 해체 또는 게임 종료 후 퇴장 처리해주세요.',
      );
    }

    const left = await this.prisma.attendance.update({
      where: { id },
      data: { status: 'LEFT', leftAt: new Date() },
      include: { member: true },
    });
    return toAttendanceResponse(left);
  }
}
