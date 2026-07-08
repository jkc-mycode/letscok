import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  IApiResponse,
  ICheckInCodeResponse,
  ISession,
  ISessionSnapshot,
} from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // 모임 시작 (운영진 전용)
  @Post()
  @UseGuards(AdminGuard)
  async open(): Promise<IApiResponse<ISession>> {
    return { success: true, data: await this.sessionsService.open() };
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

  // 현장 체크인 코드 — 운영진 전용 (QR 렌더용). 공개 스냅샷엔 코드를 안 싣기 때문에 별도 경로
  @Get('current/checkin-code')
  @UseGuards(AdminGuard)
  async getCheckInCode(): Promise<IApiResponse<ICheckInCodeResponse>> {
    return { success: true, data: { code: await this.sessionsService.getCurrentCheckInCode() } };
  }
}
