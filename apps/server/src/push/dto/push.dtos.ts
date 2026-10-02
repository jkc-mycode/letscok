import { ISubscribePushDto, IUnsubscribePushDto } from '@letscok/shared-types';
import { IsString, IsUrl, Length } from 'class-validator';

// 푸시 서비스 주소는 항상 https 외부 URL (FCM·APNs·Mozilla 등)
const ENDPOINT_URL = { protocols: ['https'], require_protocol: true };

export class SubscribePushDto implements ISubscribePushDto {
  @IsString()
  memberId: string;

  @IsUrl(ENDPOINT_URL, { message: '올바르지 않은 구독 정보입니다.' })
  @Length(1, 1000)
  endpoint: string;

  @IsString()
  @Length(1, 200)
  p256dh: string;

  @IsString()
  @Length(1, 200)
  auth: string;
}

export class UnsubscribePushDto implements IUnsubscribePushDto {
  @IsUrl(ENDPOINT_URL, { message: '올바르지 않은 구독 정보입니다.' })
  @Length(1, 1000)
  endpoint: string;
}
