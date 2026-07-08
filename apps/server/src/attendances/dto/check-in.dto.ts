import { ICheckInDto } from '@letscok/shared-types';
import { IsString } from 'class-validator';

// 체크인 요청 body — 이름 검색으로 고른 회원 id 하나만 받는다 (세션 id는 URL 파라미터)
export class CheckInDto implements ICheckInDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;
}
