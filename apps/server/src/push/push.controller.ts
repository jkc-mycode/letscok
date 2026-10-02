import { Body, Controller, Delete, Get, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IPushPublicKey } from '@letscok/shared-types';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dtos';
import { PushService } from './push.service';

// 모임원 본인이 /m에서 쓰는 셀프 액션이라 가드 없음 (rest/resume과 같은 신뢰 모델)
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
  ): Promise<IApiResponse<{ ok: boolean }>> {
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
