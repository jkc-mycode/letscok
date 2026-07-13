import { IManualCheckInDto } from '@letscok/shared-types';
import { IsString } from 'class-validator';

// 운영진 수동 체크인 body — AdminGuard 뒤라 현장 코드 대조 없음
export class ManualCheckInDto implements IManualCheckInDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;
}
