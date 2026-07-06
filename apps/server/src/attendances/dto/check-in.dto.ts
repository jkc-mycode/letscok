import { ICheckInDto } from '@letscok/shared-types';
import { IsString } from 'class-validator';

export class CheckInDto implements ICheckInDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;
}
