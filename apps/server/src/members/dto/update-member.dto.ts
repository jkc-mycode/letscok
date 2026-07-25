import {
  Gender,
  Grade,
  IUpdateMemberDto,
  MemberRole,
} from '@letscok/shared-types';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

// 회원 정보 수정 요청 body — 모든 필드 선택적, 보낸 것만 반영 (관제판 [모임원 관리] 전용)
// isGuest는 false만 허용: 게스트→정회원 승격 전용이고, 역방향 강등은 정책에 없다 (서비스에서 검증)
export class UpdateMemberDto implements IUpdateMemberDto {
  @IsOptional()
  @IsString({ message: '이름을 입력해주세요.' })
  @Length(1, 20, { message: '이름은 1~20자여야 합니다.' })
  name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '생년월일은 YYYY-MM-DD 형식이어야 합니다.',
  })
  birthDate?: string;

  @IsOptional()
  @IsIn(Object.values(Grade), { message: '급수는 A~F 중 하나여야 합니다.' })
  grade?: Grade;

  @IsOptional()
  @IsIn(Object.values(Gender), { message: '성별을 선택해주세요.' })
  gender?: Gender;

  @IsOptional()
  @IsIn(Object.values(MemberRole), { message: '역할이 올바르지 않습니다.' })
  role?: MemberRole;

  // true는 서비스에서 거부 — 승격(false)만 통과
  @IsOptional()
  @IsIn([false], { message: '정회원을 게스트로 되돌릴 수 없습니다.' })
  isGuest?: boolean;
}
