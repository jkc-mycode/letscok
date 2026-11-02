import { IsOptional, IsString, MaxLength } from 'class-validator';

// 공개 현황 쿼리 — 문자열이 아닌 값이 DB 조회까지 가지 않게 막는다
export class CurrentSessionQueryDto {
  @IsOptional()
  @IsString({ message: '올바르지 않은 모임입니다.' })
  @MaxLength(64, { message: '올바르지 않은 모임입니다.' })
  id?: string;

  @IsOptional()
  @IsString({ message: '올바르지 않은 모임원입니다.' })
  @MaxLength(64, { message: '올바르지 않은 모임원입니다.' })
  memberId?: string;
}
