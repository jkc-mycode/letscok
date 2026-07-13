import {
  Body,
  Controller,
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

  // 체크인 — 모임원이 QR 진입 후 본인 선택으로 직접 호출 (가드 없음)
  @Post('sessions/:sessionId/attendances')
  async checkIn(
    @Param('sessionId') sessionId: string,
    @Body() dto: CheckInDto,
  ): Promise<IApiResponse<IAttendance>> {
    return {
      success: true,
      data: await this.attendancesService.checkIn(sessionId, dto),
    };
  }

  // 수동 체크인 (운영진 전용) — QR 오픈 지연 등 예외 상황에서 운영진이 대신 체크인
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
}
