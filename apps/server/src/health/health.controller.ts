import { Controller, Get } from '@nestjs/common';
import type { IApiResponse } from '@letscok/shared-types';

@Controller('health')
export class HealthController {
  // 웜업 핑 대상 — DB 미접근으로 가볍게 유지 (매일 19~23시 KST 10분 간격 호출)
  @Get()
  check(): IApiResponse<{ status: string }> {
    return { success: true, data: { status: 'ok' } };
  }
}
