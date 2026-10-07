import { MemberListFilter, MemberListSort } from '@letscok/shared-types';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// 모임원 관리 목록 쿼리 — 탭·검색·페이지(1부터). 모두 생략 가능
export class MemberPageQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'REGULAR', 'GUEST', 'DELETED'], { message: '올바르지 않은 목록 종류입니다.' })
  filter?: MemberListFilter;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '검색어는 20자까지예요.' })
  q?: string;

  @IsOptional()
  @Matches(/^[1-9]\d{0,3}$/, { message: '올바르지 않은 페이지입니다.' })
  page?: string;

  @IsOptional()
  @IsIn(['RECENT', 'NAME', 'ATTENDANCE', 'CREATED', 'GRADE'], { message: '올바르지 않은 정렬입니다.' })
  sort?: MemberListSort;
}
