import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  IApiResponse,
  ICheckInCodeResponse,
  IClosedTodayResponse,
  ISession,
  ISessionSnapshot,
} from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { OpenSessionDto } from './dto/open-session.dto';
import { UpdateCheckInCodeDto } from './dto/update-check-in-code.dto';
import { UpdateSessionLabelDto } from './dto/update-session-label.dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // 모임 시작 (운영진 전용) — 본문 없으면 같은 날 종료한 모임을 다시 연다, fresh면 새 모임, resumeId면 고른 모임 재개
  @Post()
  @UseGuards(AdminGuard)
  async open(@Body() dto: OpenSessionDto): Promise<IApiResponse<ISession>> {
    return {
      success: true,
      data: await this.sessionsService.open(dto.fresh === true, dto.label, dto.resumeId),
    };
  }

  // 모임 이름 바꾸기 (운영진 전용) — 동시에 연 모임을 구분하는 이름(여복·남복)
  @Patch(':id/label')
  @UseGuards(AdminGuard)
  async updateLabel(
    @Param('id') id: string,
    @Body() dto: UpdateSessionLabelDto,
  ): Promise<IApiResponse<ISession>> {
    return { success: true, data: await this.sessionsService.updateLabel(id, dto.label) };
  }

  // 오늘 종료한 모임 (운영진 전용) — 목록이 비어 있지 않으면 [모임 시작] 전에 고르는 창을 띄운다
  @Get('closed-today')
  @UseGuards(AdminGuard)
  async getClosedToday(): Promise<IApiResponse<IClosedTodayResponse>> {
    return { success: true, data: await this.sessionsService.getClosedToday() };
  }

  // 모임 종료 (운영진 전용)
  @Patch(':id/close')
  @UseGuards(AdminGuard)
  async close(@Param('id') id: string): Promise<IApiResponse<ISession>> {
    return { success: true, data: await this.sessionsService.close(id) };
  }

  // 현재 진행 중 세션 스냅샷 — 모임원도 보드 현황을 봐야 하므로 가드 없음
  // 동시에 연 모임이 있으면 id(화면이 고른 모임)·memberId(내가 출석한 모임)로 고른다
  @Get('current')
  async getCurrent(
    @Query('id') id?: string,
    @Query('memberId') memberId?: string,
  ): Promise<IApiResponse<ISessionSnapshot>> {
    return { success: true, data: await this.sessionsService.getCurrentSnapshot({ id, memberId }) };
  }

  // 체크인 코드 — 운영진 전용 (관제판 표시·변경용). 공개 스냅샷엔 코드를 안 싣기 때문에 별도 경로
  @Get('current/checkin-code')
  @UseGuards(AdminGuard)
  async getCheckInCode(): Promise<IApiResponse<ICheckInCodeResponse>> {
    return { success: true, data: { code: await this.sessionsService.getCurrentCheckInCode() } };
  }

  // 코드 변경 (운영진 전용) — 열린 모임 전부에 적용되고, 다음 모임에도 승계된다
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
