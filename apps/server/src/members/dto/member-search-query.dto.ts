import { IsOptional, IsString, MaxLength } from 'class-validator';

// 공개 이름 검색 쿼리 — 같은 이름을 두 번 보내면 배열이 되어 500이 나던 곳(반복하면 Sentry 무료 한도가 찬다)
export class MemberSearchQueryDto {
  @IsOptional()
  @IsString({ message: '검색할 이름을 입력해주세요.' })
  @MaxLength(20, { message: '검색어는 20자까지예요.' })
  name?: string;
}
