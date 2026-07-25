import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IAttendance } from '@letscok/shared-types';
import { toAttendanceResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { CheckInDto } from './dto/check-in.dto';

// 코드 오입력 잠금 — 코드가 숫자 4자리(1만 가지)라 무차별 대입이 현실적이어서 실패만 센다
// 성공 요청은 세지 않는다: 체육관 공용 와이파이면 여러 명이 한 IP로 들어오므로
// 전역 rate limit만으로 막으면 정상 체크인이 같이 걸린다
const CODE_FAIL_LIMIT = 10;
const CODE_FAIL_WINDOW_MS = 10 * 60_000;

@Injectable()
export class AttendancesService {
  // 인메모리 카운터 — Render 단일 인스턴스 전제이고 재시작하면 초기화된다.
  // 코드는 실질 방어선이 아니라(콕 확인이 게이트) 스크립트 대입 지연이 목적이라 이 정도면 충분
  private readonly codeFailures = new Map<
    string,
    { count: number; firstAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly realtime: RealtimeService,
  ) {}

  async checkIn(
    sessionId: string,
    dto: CheckInDto,
    ip = 'unknown',
  ): Promise<IAttendance> {
    this.assertNotLockedOut(ip);
    const session = await this.sessionsService.findOpenSessionOrThrow(sessionId);

    // 코드 대조 — 세션에 코드가 있으면 입력한 code가 일치해야 통과
    // (코드 없는 레거시 세션은 grandfather로 통과 — 배포 시 진행 중이던 세션이 안 깨지게)
    if (session.checkInCode && dto.code !== session.checkInCode) {
      this.recordCodeFailure(ip);
      throw new ForbiddenException('코드가 맞지 않아요. 다시 확인해주세요.');
    }

    // 운영진 대리 등록은 동의를 못 받으므로 본인이 처음 들어오는 이 시점에 받는다
    // 이미 수동 체크인된 사람은 아래에서 409가 나므로, 동의 기록은 반드시 그보다 먼저
    await this.recordConsentIfNeeded(dto.memberId, dto.consent);

    return this.checkInMember(sessionId, dto.memberId);
  }

  private assertNotLockedOut(ip: string) {
    const entry = this.codeFailures.get(ip);
    if (!entry) return;
    // 창이 지났으면 초기화 — 잠금은 누적이 아니라 최근 10분 기준
    if (Date.now() - entry.firstAt > CODE_FAIL_WINDOW_MS) {
      this.codeFailures.delete(ip);
      return;
    }
    if (entry.count >= CODE_FAIL_LIMIT) {
      throw new HttpException(
        '코드를 여러 번 잘못 입력했어요. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordCodeFailure(ip: string) {
    const now = Date.now();
    // 기록 시점에 만료된 항목을 함께 정리 — 별도 타이머 없이 Map이 무한히 커지는 것만 막는다
    for (const [key, value] of this.codeFailures) {
      if (now - value.firstAt > CODE_FAIL_WINDOW_MS) this.codeFailures.delete(key);
    }
    const entry = this.codeFailures.get(ip);
    if (entry) {
      entry.count += 1;
      return;
    }
    this.codeFailures.set(ip, { count: 1, firstAt: now });
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

  // 출석 취소 — 사전 수동 체크인 후 개인 사정·노쇼 등으로 못 오게 된 사람용.
  // 행을 아예 지워 출석·랭킹 집계에서 뺀다 (퇴장 처리는 "왔다 간 사람"이라 기록이 남는 것과 구분)
  // 콕 확인 전만 허용: 확인 전엔 게임에 못 들어가는 구조라 지워도 얽힌 기록이 없다
  async cancelCheckIn(id: string): Promise<IAttendance> {
    const attendance = await this.findAttendanceOrThrow(id);
    if (attendance.shuttleConfirmedAt) {
      throw new ConflictException(
        '콕 확인된 모임원입니다. 실제로 참석했다면 퇴장 처리를 사용해주세요.',
      );
    }
    if (attendance.status !== 'CHECKED_IN') {
      throw new ConflictException('대기 상태의 출석만 취소할 수 있습니다.');
    }
    // 콕 미확인은 게임에 못 들어가지만, 규칙이 바뀌어도 기록이 깨지지 않게 이중 안전망
    const played = await this.prisma.gamePlayer.count({
      where: { attendanceId: attendance.id },
    });
    if (played > 0) {
      throw new ConflictException('게임 기록이 있는 출석은 취소할 수 없습니다.');
    }

    const removed = await this.prisma.attendance.delete({
      where: { id: attendance.id },
      include: { member: true },
    });
    this.realtime.broadcastSnapshot(attendance.sessionId);
    return toAttendanceResponse(removed);
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
