import { Body, Controller, Delete, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IPushPublicKey } from '@letscok/shared-types';
import { verifyMemberToken } from '../common/auth/member-token';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dtos';
import { PushService } from './push.service';

// 모임원 본인이 /m에서 쓰는 셀프 액션 — 등록은 그 회원의 본인 확인 값이 있어야 한다(남의 알림을 내 폰으로 받지 못하게)
// 해지는 endpoint 자체가 그 기기만 아는 값이라 따로 확인하지 않는다
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('public-key')
  getPublicKey(): IApiResponse<IPushPublicKey> {
    return { success: true, data: this.pushService.getPublicKey() };
  }

  @Post('subscriptions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async subscribe(
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-member-token') memberToken?: string,
  ): Promise<IApiResponse<{ ok: boolean }>> {
    if (!verifyMemberToken(dto.memberId, memberToken)) {
      throw new UnauthorizedException('본인 확인이 필요해요. 입장 코드를 다시 넣어 주세요.');
    }
    await this.pushService.subscribe(dto, userAgent);
    return { success: true, data: { ok: true } };
  }

  @Delete('subscriptions')
  async unsubscribe(
    @Body() dto: UnsubscribePushDto,
  ): Promise<IApiResponse<{ deleted: number }>> {
    return { success: true, data: await this.pushService.unsubscribe(dto.endpoint) };
  }
}
