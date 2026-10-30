import { IIssueMemberTokenDto } from '@letscok/shared-types';
import { IsOptional, IsString } from 'class-validator';

// 본인 확인 값 요청 body — 체크인과 같은 회원 id + 입장 코드. 세션 id는 URL 파라미터
export class IssueMemberTokenDto implements IIssueMemberTokenDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;

  @IsOptional()
  @IsString()
  code?: string;
}
