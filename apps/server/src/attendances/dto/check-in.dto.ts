import { ICheckInDto } from '@letscok/shared-types';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

// 체크인 요청 body — 회원 id + 모임원이 입력한 코드. 세션 id는 URL 파라미터
export class CheckInDto implements ICheckInDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;

  // 코드 대조는 서비스에서(세션 값과 비교). 여기선 형식만 — 없을 수도 있음(코드 없는 레거시 세션)
  @IsOptional()
  @IsString()
  code?: string;

  // 아직 동의 이력이 없는 회원(운영진 대리 등록)만 필요 — 서비스에서 판단
  @IsOptional()
  @IsBoolean()
  consent?: boolean;

  // 대리 체크인일 때 이 폰 주인 — 확인 값 대조는 서비스에서
  @IsOptional()
  @IsString()
  byMemberId?: string;
}
