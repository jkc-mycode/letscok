import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IAttendance } from '@letscok/shared-types';
import { toAttendanceResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class AttendancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly realtime: RealtimeService,
  ) {}

  async checkIn(sessionId: string, dto: CheckInDto): Promise<IAttendance> {
    const session = await this.sessionsService.findOpenSessionOrThrow(sessionId);

    // 현장 코드 대조 — 세션에 코드가 있으면 QR로 받은 code가 일치해야 통과
    // (코드 없는 레거시 세션은 grandfather로 통과 — 배포 시 진행 중이던 세션이 안 깨지게)
    if (session.checkInCode && dto.code !== session.checkInCode) {
      throw new ForbiddenException('현장 QR을 스캔해 체크인해주세요.');
    }

    // 운영진 대리 등록은 동의를 못 받으므로 본인이 처음 들어오는 이 시점에 받는다
    // 이미 수동 체크인된 사람은 아래에서 409가 나므로, 동의 기록은 반드시 그보다 먼저
    await this.recordConsentIfNeeded(dto.memberId, dto.consent);

    return this.checkInMember(sessionId, dto.memberId);
  }

  private async recordConsentIfNeeded(memberId: string, consent?: boolean) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('등록되지 않은 모임원입니다.');
    }
    if (member.consentedAt) return;

    if (consent !== true) {
      throw new ForbiddenException('개인정보 수집·이용에 동의해주세요.');
    }
    await this.prisma.member.update({
      where: { id: memberId },
      data: { consentedAt: new Date() },
    });
  }

  // 운영진 수동 체크인 — AdminGuard 뒤라 코드 대조 생략, 나머지 정책(재입장·409)은 공개 체크인과 동일
  async manualCheckIn(sessionId: string, memberId: string): Promise<IAttendance> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    return this.checkInMember(sessionId, memberId);
  }

  private async checkInMember(
    sessionId: string,
    memberId: string,
  ): Promise<IAttendance> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('등록되지 않은 모임원입니다.');
    }

    const existing = await this.prisma.attendance.findUnique({
      where: { sessionId_memberId: { sessionId, memberId } },
      include: { member: true },
    });

    // 첫 체크인
    if (!existing) {
      const attendance = await this.prisma.attendance.create({
        data: { sessionId, memberId },
        include: { member: true },
      });
      this.realtime.broadcastSnapshot(sessionId);
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
      this.realtime.broadcastSnapshot(sessionId);
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
    this.realtime.broadcastSnapshot(attendance.sessionId);
    return toAttendanceResponse(left);
  }

  // 잠깐 휴식 — 본인(/m)과 운영진 관제판이 같은 API를 쓴다
  // waitingSince를 휴식 시작 시각으로 갱신해 "쉰 지 N분" 표시에 재사용
  async rest(id: string): Promise<IAttendance> {
    const attendance = await this.findAttendanceOrThrow(id);
    if (attendance.status === 'RESTING') {
      return toAttendanceResponse(attendance); // 더블탭 안전 — 이미 휴식 중이면 그대로
    }
    // 조합에 묶인 채 빠지면 조합이 3명으로 깨진다 — 교체/해체는 운영진 판단
    if (attendance.status === 'MATCHED' || attendance.status === 'PLAYING') {
      throw new ConflictException(
        '이미 게임 조합에 들어가 있어요. 쉬려면 운영진에게 말씀해주세요.',
      );
    }
    if (attendance.status === 'LEFT') {
      throw new ConflictException('퇴장 처리된 모임원입니다.');
    }

    const resting = await this.prisma.attendance.update({
      where: { id },
      data: { status: 'RESTING', waitingSince: new Date() },
      include: { member: true },
    });
    this.realtime.broadcastSnapshot(attendance.sessionId);
    return toAttendanceResponse(resting);
  }

  // 휴식 복귀 — 쉬는 동안은 기다린 게 아니므로 대기시간 리셋 (퇴장→재입장과 동일 규칙)
  async resume(id: string): Promise<IAttendance> {
    const attendance = await this.findAttendanceOrThrow(id);
    if (attendance.status === 'CHECKED_IN') {
      return toAttendanceResponse(attendance); // 더블탭 안전 — 이미 대기 중이면 그대로
    }
    if (attendance.status !== 'RESTING') {
      throw new ConflictException('휴식 중인 모임원이 아닙니다.');
    }

    const resumed = await this.prisma.attendance.update({
      where: { id },
      data: { status: 'CHECKED_IN', waitingSince: new Date() },
      include: { member: true },
    });
    this.realtime.broadcastSnapshot(attendance.sessionId);
    return toAttendanceResponse(resumed);
  }

  // 콕 제출 확인 — 돈에 준하는 검증이라 운영진 전용(컨트롤러 AdminGuard)
  // 확인 시점이 곧 참여 시작이므로 waitingSince를 여기 맞춘다 (일찍 와서 콕만 늦게 낸 사람이 대기줄 앞을 차지하지 않게)
  async confirmShuttle(id: string): Promise<IAttendance> {
    const attendance = await this.findAttendanceOrThrow(id);
    if (attendance.shuttleConfirmedAt) {
      return toAttendanceResponse(attendance); // 더블탭 안전
    }
    if (attendance.status === 'LEFT') {
      throw new ConflictException('퇴장 처리된 모임원입니다.');
    }

    const now = new Date();
    const confirmed = await this.prisma.attendance.update({
      where: { id },
      data: { shuttleConfirmedAt: now, waitingSince: now },
      include: { member: true },
    });
    this.realtime.broadcastSnapshot(attendance.sessionId);
    return toAttendanceResponse(confirmed);
  }

  // 잘못 누른 경우 되돌리기 — 이미 조합·게임에 들어간 사람은 막는다
  // (진행 중 게임을 깨지 않기 위해. 그 경우 조합 해체·게임 종료가 먼저)
  async cancelShuttle(id: string): Promise<IAttendance> {
    const attendance = await this.findAttendanceOrThrow(id);
    if (!attendance.shuttleConfirmedAt) {
      return toAttendanceResponse(attendance); // 더블탭 안전
    }
    if (attendance.status === 'MATCHED' || attendance.status === 'PLAYING') {
      throw new ConflictException(
        '게임에 배정된 모임원입니다. 조합 해체 또는 게임 종료 후 취소해주세요.',
      );
    }

    const cancelled = await this.prisma.attendance.update({
      where: { id },
      data: { shuttleConfirmedAt: null },
      include: { member: true },
    });
    this.realtime.broadcastSnapshot(attendance.sessionId);
    return toAttendanceResponse(cancelled);
  }

  private async findAttendanceOrThrow(id: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      include: { member: true },
    });
    if (!attendance) {
      throw new NotFoundException('출석 정보를 찾을 수 없습니다.');
    }
    return attendance;
  }
}
