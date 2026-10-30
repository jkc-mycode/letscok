import {
  Body,
  Controller,
  Delete,
  Ip,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IAttendance, IMemberTokenResponse, IPushCallResult } from '@letscok/shared-types';
import type { Request } from 'express';
import { verifyMemberToken } from '../common/auth/member-token';
import { AdminGuard, isAdminRequest } from '../common/guards/admin.guard';
import { AttendancesService } from './attendances.service';
import { CheckInDto } from './dto/check-in.dto';
import { IssueMemberTokenDto } from './dto/issue-member-token.dto';
import { ManualCheckInDto } from './dto/manual-check-in.dto';
import { SetPartnerDto } from './dto/set-partner.dto';
import { PartnersService } from './partners.service';

@Controller()
export class AttendancesController {
  constructor(
    private readonly attendancesService: AttendancesService,
    private readonly partnersService: PartnersService,
  ) {}

  // 대회 연습 파트너 지정·해제 (운영진) — 그날 게임 추천이 두 사람을 같은 게임에 넣는 쪽으로 기운다
  @Post('sessions/:sessionId/partners')
  @UseGuards(AdminGuard)
  async setPartner(
    @Param('sessionId') sessionId: string,
    @Body() dto: SetPartnerDto,
  ): Promise<IApiResponse<IAttendance[]>> {
    return { success: true, data: await this.partnersService.set(sessionId, dto.attendanceIds) };
  }

  @Delete('attendances/:id/partner')
  @UseGuards(AdminGuard)
  async clearPartner(@Param('id') id: string): Promise<IApiResponse<IAttendance>> {
    return { success: true, data: await this.partnersService.clear(id) };
  }

  // 체크인 — 모임원이 코드 입력 후 본인 선택으로 직접 호출 (가드 없음)
  // 코드 오입력 잠금은 서비스에서 IP 단위로 — 공용 와이파이를 고려해 실패만 센다
  @Post('sessions/:sessionId/attendances')
  async checkIn(
    @Param('sessionId') sessionId: string,
    @Body() dto: CheckInDto,
    @Ip() ip: string,
  ): Promise<IApiResponse<IAttendance>> {
    return {
      success: true,
      data: await this.attendancesService.checkIn(sessionId, dto, ip),
    };
  }

  // 수동 체크인 (운영진 전용) — 사전 등록·현장 대리 등 예외 상황에서 운영진이 대신 체크인
  @Post('sessions/:sessionId/attendances/manual')
  @UseGuards(AdminGuard)
  async manualCheckIn(
    @Param('sessionId') sessionId: string,
    @Body() dto: ManualCheckInDto,
  ): Promise<IApiResponse<IAttendance>> {
    return {
      success: true,
      data: await this.attendancesService.manualCheckIn(
        sessionId,
        dto.memberId,
      ),
    };
  }

  // 출석 취소 (운영진 전용) — 사전 체크인 후 못 오게 된 사람(개인 사정·노쇼)을 집계 없이 제거. 콕 확인 전만 가능
  @Delete('attendances/:id')
  @UseGuards(AdminGuard)
  async cancelCheckIn(
    @Param('id') id: string,
  ): Promise<IApiResponse<IAttendance>> {
    return {
      success: true,
      data: await this.attendancesService.cancelCheckIn(id),
    };
  }

  // 퇴장 처리 (운영진 전용)
  @Patch('attendances/:id/leave')
  @UseGuards(AdminGuard)
  async leave(@Param('id') id: string): Promise<IApiResponse<IAttendance>> {
    return { success: true, data: await this.attendancesService.leave(id) };
  }

  // 운영진 호출 (운영진 전용) — 해당 모임원 폰으로 "운영진이 찾고 있어요" 푸시
  @Post('attendances/:id/call')
  @UseGuards(AdminGuard)
  async call(@Param('id') id: string): Promise<IApiResponse<IPushCallResult>> {
    return { success: true, data: await this.attendancesService.call(id) };
  }

  // 본인 확인 값 받기 — 체크인과 같은 코드·잠금. 값은 /m의 휴식/복귀와 알림 등록에 쓴다
  @Post('sessions/:sessionId/member-token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async issueMemberToken(
    @Param('sessionId') sessionId: string,
    @Body() dto: IssueMemberTokenDto,
    @Ip() ip: string,
  ): Promise<IApiResponse<IMemberTokenResponse>> {
    return { success: true, data: await this.attendancesService.issueMemberToken(sessionId, dto, ip) };
  }

  // 잠깐 휴식/복귀 — 본인이 /m에서 직접 쓰는 셀프 액션. 운영진 관제판도 같은 API를 사용한다
  @Patch('attendances/:id/rest')
  async rest(@Param('id') id: string, @Req() req: Request): Promise<IApiResponse<IAttendance>> {
    await this.assertSelfOrAdmin(id, req);
    return { success: true, data: await this.attendancesService.rest(id) };
  }

  @Patch('attendances/:id/resume')
  async resume(@Param('id') id: string, @Req() req: Request): Promise<IApiResponse<IAttendance>> {
    await this.assertSelfOrAdmin(id, req);
    return { success: true, data: await this.attendancesService.resume(id) };
  }

  // 출석 id는 공개 현황에 다 실려 있어 id만으로는 남의 출석을 바꿀 수 있었다 — 운영진이거나 그 회원의 확인 값을 든 기기만
  private async assertSelfOrAdmin(attendanceId: string, req: Request): Promise<void> {
    const admin = isAdminRequest(
      { authorization: req.headers.authorization, passcode: req.headers['x-admin-passcode'] },
      req.ip ?? 'unknown',
    );
    if (admin) return;
    const memberId = await this.attendancesService.findMemberIdOrThrow(attendanceId);
    if (!verifyMemberToken(memberId, req.headers['x-member-token'])) {
      throw new UnauthorizedException('본인 확인이 필요해요. 입장 코드를 다시 넣어 주세요.');
    }
  }

  // 콕 제출 확인/취소 (운영진 전용) — 회비에 준하는 검증이라 셀프 불가
  @Patch('attendances/:id/shuttle')
  @UseGuards(AdminGuard)
  async confirmShuttle(
    @Param('id') id: string,
  ): Promise<IApiResponse<IAttendance>> {
    return {
      success: true,
      data: await this.attendancesService.confirmShuttle(id),
    };
  }

  @Patch('attendances/:id/shuttle/cancel')
  @UseGuards(AdminGuard)
  async cancelShuttle(
    @Param('id') id: string,
  ): Promise<IApiResponse<IAttendance>> {
    return {
      success: true,
      data: await this.attendancesService.cancelShuttle(id),
    };
  }
}
