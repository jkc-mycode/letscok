import { ICheckInDto } from '@letscok/shared-types';
import { IsOptional, IsString } from 'class-validator';

// 체크인 요청 body — 회원 id + 현장 코드(QR ?c=). 세션 id는 URL 파라미터
export class CheckInDto implements ICheckInDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;

  // 코드 대조는 서비스에서(세션 값과 비교). 여기선 형식만 — 없을 수도 있음(레거시 세션·수동 폴백)
  @IsOptional()
  @IsString()
  code?: string;
}
