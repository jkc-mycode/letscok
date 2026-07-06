import { Controller, Post, UseGuards } from '@nestjs/common';
import { IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('auth')
export class AuthController {
  // 운영진 로그인 화면에서 패스코드가 맞는지만 확인 — 검증 자체는 AdminGuard가 수행
  // (통과하면 200, 틀리면 가드가 401을 던짐)
  @Post('admin/verify')
  @UseGuards(AdminGuard)
  verify(): IApiResponse<{ ok: boolean }> {
    return { success: true, data: { ok: true } };
  }
}
