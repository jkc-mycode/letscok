import { ISetPartnerDto } from '@letscok/shared-types';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

// 대회 연습 파트너 지정 — 두 사람의 출석 id
export class SetPartnerDto implements ISetPartnerDto {
  @IsArray()
  @ArrayMinSize(2, { message: '두 사람을 골라주세요.' })
  @ArrayMaxSize(2, { message: '두 사람을 골라주세요.' })
  @IsString({ each: true })
  attendanceIds: string[];
}
