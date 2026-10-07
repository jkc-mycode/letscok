import { Gender, Grade, ICreateMemberDto } from '@letscok/shared-types';
import {
  IsBoolean,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

// 회원 등록 요청 body — 운영진 관제판의 등록 폼에서만 넘어온다(자가 가입 차단)
// 개인정보 동의는 여기서 받지 않는다 — 대리 등록이라 본인 의사가 아니므로, 첫 체크인 때 본인에게 받는다
export class CreateMemberDto implements ICreateMemberDto {
  @IsString({ message: '이름을 입력해주세요.' })
  @Length(1, 20, { message: '이름은 1~20자여야 합니다.' })
  name: string;

  // 생략 가능 — 모르면 비워 두고 나중에 채운다(비우면 서비스가 같은 이름을 막는다). 게스트는 보내와도 null 저장
  @ValidateIf((dto: CreateMemberDto) => dto.isGuest !== true && dto.birthDate !== undefined && dto.birthDate !== null)
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
}
