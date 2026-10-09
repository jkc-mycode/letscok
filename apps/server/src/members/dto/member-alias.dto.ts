import { IsString, Length } from 'class-validator';

// 소모임 표기 직접 추가 — 모임원 수정 화면에서
export class CreateMemberAliasDto {
  @IsString({ message: '소모임 이름을 입력해주세요.' })
  @Length(1, 30, { message: '소모임 이름은 1~30자여야 해요.' })
  alias: string;
}
