import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IAttendance } from '@letscok/shared-types';
import { toAttendanceResponse } from '../common/mappers/entity.mappers';
import { MemosService } from '../memos/memos.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';

// 대회 연습 파트너 — 그날 두 사람을 같은 게임(한 팀)으로 짜 주길 바랄 때. 강제가 아니라 게임 추천 가점일 뿐이다
// 한 사람은 파트너가 한 명 — 새로 지정하면 두 사람 각자의 이전 파트너는 풀린다
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly realtime: RealtimeService,
    private readonly memos: MemosService,
  ) {}

  async set(sessionId: string, attendanceIds: string[]): Promise<IAttendance[]> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const [a, b] = attendanceIds;
    if (attendanceIds.length !== 2 || a === b) throw new BadRequestException('서로 다른 두 사람을 골라주세요.');
    const pair = await this.prisma.attendance.findMany({
      where: { id: { in: [a, b] }, sessionId, status: { not: 'LEFT' } },
      include: { member: true },
    });
    if (pair.length !== 2) throw new ConflictException('퇴장했거나 이 모임에 없는 모임원이 있어요.');

    const updated = await this.prisma.$transaction(async (tx) => {
      // 두 사람의 예전 짝을 먼저 풀고(그 짝이 아직 이 사람을 가리키지 않게) 서로를 가리키게 한다
      await tx.attendance.updateMany({
        where: { sessionId, OR: [{ partnerAttendanceId: { in: [a, b] } }, { id: { in: [a, b] } }] },
        data: { partnerAttendanceId: null },
      });
      await tx.attendance.update({ where: { id: a }, data: { partnerAttendanceId: b } });
      await tx.attendance.update({ where: { id: b }, data: { partnerAttendanceId: a } });
      return tx.attendance.findMany({ where: { id: { in: [a, b] } }, include: { member: true } });
    });
    // 기록용 메모 — 메모를 지워도 파트너는 그대로(메모는 운영진끼리 보는 기록)
    const names = [a, b].map((id) => pair.find((p) => p.id === id)!.member.name);
    await this.memos.create(`🤝 대회 연습 파트너: ${names.join(', ')} — 같은 게임 한 팀으로 우선 짜기(오늘만)`);
    this.realtime.broadcastSnapshot(sessionId);
    return updated.map(toAttendanceResponse);
  }

  // 해제 — 이 사람과 짝 모두
  async clear(attendanceId: string): Promise<IAttendance> {
    const attendance = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!attendance) throw new NotFoundException('출석 정보를 찾을 수 없습니다.');
    await this.prisma.attendance.updateMany({
      where: {
        sessionId: attendance.sessionId,
        OR: [{ id: attendanceId }, { partnerAttendanceId: attendanceId }],
      },
      data: { partnerAttendanceId: null },
    });
    this.realtime.broadcastSnapshot(attendance.sessionId);
    const cleared = await this.prisma.attendance.findUniqueOrThrow({ where: { id: attendanceId }, include: { member: true } });
    return toAttendanceResponse(cleared);
  }
}
