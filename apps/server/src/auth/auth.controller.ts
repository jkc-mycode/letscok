import { Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IAdminTokenResponse, IApiResponse } from '@letscok/shared-types';
import { issueAdminToken } from '../common/auth/admin-token';
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

  // 로그인 — 패스코드가 맞으면 30일짜리 출입증 발급. 서버에 비밀값이 없으면 token=null(웹은 패스코드 방식으로 계속)
  // 패스코드 확인은 AdminGuard(연속 실패 잠금 포함)가 한다
  @Post('admin/token')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  token(): IApiResponse<IAdminTokenResponse> {
    const issued = issueAdminToken();
    return { success: true, data: { token: issued?.token ?? null, expiresAt: issued?.expiresAt ?? null } };
  }
}
