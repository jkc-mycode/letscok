import {
  Body,
  Controller,
  Ip,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IApiResponse, IAttendance } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { AttendancesService } from './attendances.service';
import { CheckInDto } from './dto/check-in.dto';
import { ManualCheckInDto } from './dto/manual-check-in.dto';

@Controller()
export class AttendancesController {
  constructor(private readonly attendancesService: AttendancesService) {}

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

  // 퇴장 처리 (운영진 전용)
  @Patch('attendances/:id/leave')
  @UseGuards(AdminGuard)
  async leave(@Param('id') id: string): Promise<IApiResponse<IAttendance>> {
    return { success: true, data: await this.attendancesService.leave(id) };
  }

  // 잠깐 휴식/복귀 — 본인이 /m에서 직접 쓰는 셀프 액션이라 가드 없음(체크인과 같은 신뢰 모델)
  // 운영진 관제판도 같은 API를 사용한다
  @Patch('attendances/:id/rest')
  async rest(@Param('id') id: string): Promise<IApiResponse<IAttendance>> {
    return { success: true, data: await this.attendancesService.rest(id) };
  }

  @Patch('attendances/:id/resume')
  async resume(@Param('id') id: string): Promise<IApiResponse<IAttendance>> {
    return { success: true, data: await this.attendancesService.resume(id) };
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
