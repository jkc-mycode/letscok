import { Gender, Grade, ICreateMemberDto } from '@letscok/shared-types';
import { Equals, IsBoolean, IsIn, IsString, Length, Matches } from 'class-validator';

export class CreateMemberDto implements ICreateMemberDto {
  @IsString({ message: '이름을 입력해주세요.' })
  @Length(1, 20, { message: '이름은 1~20자여야 합니다.' })
  name: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '생년월일은 YYYY-MM-DD 형식이어야 합니다.',
  })
  birthDate: string;

  @IsIn(Object.values(Grade), { message: '급수는 A~F 중 하나여야 합니다.' })
  grade: Grade;

  @IsIn(Object.values(Gender), { message: '성별을 선택해주세요.' })
  gender: Gender;

  @IsBoolean({ message: '게스트 여부를 선택해주세요.' })
  isGuest: boolean;

  @Equals(true, { message: '개인정보 수집·이용에 동의해주세요.' })
  consent: boolean;
}
