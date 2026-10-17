import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  IApiResponse,
  ICheckInCodeResponse,
  IClosedTodaySession,
  ISession,
  ISessionSnapshot,
} from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { OpenSessionDto } from './dto/open-session.dto';
import { UpdateCheckInCodeDto } from './dto/update-check-in-code.dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // 모임 시작 (운영진 전용) — 본문 없으면 같은 날 종료한 모임을 다시 연다, fresh면 새 모임
  @Post()
  @UseGuards(AdminGuard)
  async open(@Body() dto: OpenSessionDto): Promise<IApiResponse<ISession>> {
    return { success: true, data: await this.sessionsService.open(dto.fresh === true) };
  }

  // 오늘 종료한 모임 (운영진 전용) — 없으면 data null. [모임 시작] 전에 고르는 창을 띄울지 판단
  @Get('closed-today')
  @UseGuards(AdminGuard)
  async getClosedToday(): Promise<IApiResponse<IClosedTodaySession | null>> {
    return { success: true, data: await this.sessionsService.getClosedToday() };
  }

  // 모임 종료 (운영진 전용)
  @Patch(':id/close')
  @UseGuards(AdminGuard)
  async close(@Param('id') id: string): Promise<IApiResponse<ISession>> {
    return { success: true, data: await this.sessionsService.close(id) };
  }

  // 현재 진행 중 세션 스냅샷 — 모임원도 보드 현황을 봐야 하므로 가드 없음
  @Get('current')
  async getCurrent(): Promise<IApiResponse<ISessionSnapshot>> {
    return { success: true, data: await this.sessionsService.getCurrentSnapshot() };
  }

  // 체크인 코드 — 운영진 전용 (관제판 표시·변경용). 공개 스냅샷엔 코드를 안 싣기 때문에 별도 경로
  @Get('current/checkin-code')
  @UseGuards(AdminGuard)
  async getCheckInCode(): Promise<IApiResponse<ICheckInCodeResponse>> {
    return { success: true, data: { code: await this.sessionsService.getCurrentCheckInCode() } };
  }

  // 코드 변경 (운영진 전용) — 변경값은 다음 모임에도 승계된다
  @Patch('current/checkin-code')
  @UseGuards(AdminGuard)
  async updateCheckInCode(
    @Body() dto: UpdateCheckInCodeDto,
  ): Promise<IApiResponse<ICheckInCodeResponse>> {
    return {
      success: true,
      data: { code: await this.sessionsService.updateCheckInCode(dto.code) },
    };
  }
}
