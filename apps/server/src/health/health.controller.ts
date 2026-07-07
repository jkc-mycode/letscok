import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('health')
export class HealthController {
  // Sentry 연동 확인용 — 일부러 500을 발생시켜 이벤트가 대시보드에 도착하는지 본다
  // (운영진 가드 뒤라 외부에서 임의 호출 불가)
  @Post('debug-sentry')
  @UseGuards(AdminGuard)
  debugSentry(): never {
    throw new Error('Sentry 연동 테스트 — 이 이벤트가 보이면 정상');
  }

  // 웜업 핑 대상 — DB 미접근으로 가볍게 유지 (cron-job.org가 매일 07~23시 KST 10분 간격 호출)
  @Get()
  check(): IApiResponse<{ status: string }> {
    return { success: true, data: { status: 'ok' } };
  }
}
