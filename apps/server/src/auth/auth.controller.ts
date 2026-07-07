import { Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('auth')
export class AuthController {
  // 운영진 로그인 화면에서 패스코드가 맞는지만 확인 — 검증 자체는 AdminGuard가 수행
  // (통과하면 200, 틀리면 가드가 401을 던짐)
  // 로그인 시도 지점이라 브루트포스가 집중되는 곳 — IP당 분당 5회로 강하게 제한
  @Post('admin/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  verify(): IApiResponse<{ ok: boolean }> {
    return { success: true, data: { ok: true } };
  }
}
