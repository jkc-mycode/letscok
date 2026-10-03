import { Controller, Get, UseGuards } from '@nestjs/common';
import { IAiCheckInStatus, IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { AiCheckInService } from './ai-check-in.service';

// AI 체크인은 전부 운영진 전용 — 외부에서 비용을 발생시킬 수 없게
@Controller('ai-check-in')
@UseGuards(AdminGuard)
export class AiCheckInController {
  constructor(private readonly aiCheckInService: AiCheckInService) {}

  // 웹이 AI 영역을 보여줄지 판단 (키가 없으면 enabled=false)
  @Get('status')
  status(): IApiResponse<IAiCheckInStatus> {
    return { success: true, data: this.aiCheckInService.status() };
  }
}
