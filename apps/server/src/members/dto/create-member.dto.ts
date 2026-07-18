import { Gender, Grade, ICreateMemberDto } from '@letscok/shared-types';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

// 회원 등록 요청 body — 신규 등록 폼에서 넘어온다. 검증 실패 메시지가 곧 사용자 안내 문구
// consent는 @Equals(true)라 미동의면 등록 자체가 막힌다 (동의 시각은 서비스에서 기록)
export class CreateMemberDto implements ICreateMemberDto {
  @IsString({ message: '이름을 입력해주세요.' })
  @Length(1, 20, { message: '이름은 1~20자여야 합니다.' })
  name: string;

  // 게스트는 생년월일을 받지 않는다 (운영진 대리 등록 시 물어볼 수 없음) — 정회원만 필수
  @ValidateIf((dto: CreateMemberDto) => dto.isGuest !== true)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '생년월일은 YYYY-MM-DD 형식이어야 합니다.',
  })
  birthDate?: string;

  @IsIn(Object.values(Grade), { message: '급수는 A~F 중 하나여야 합니다.' })
  grade: Grade;

  @IsIn(Object.values(Gender), { message: '성별을 선택해주세요.' })
  gender: Gender;

  @IsBoolean({ message: '게스트 여부를 선택해주세요.' })
  isGuest: boolean;

  @Equals(true, { message: '개인정보 수집·이용에 동의해주세요.' })
  consent: boolean;
}
