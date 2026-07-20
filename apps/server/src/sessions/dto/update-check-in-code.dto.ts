import { IUpdateCheckInCodeDto } from '@letscok/shared-types';
import { Matches } from 'class-validator';

// 체크인 코드 변경 요청 — 0000·1234처럼 부르기 쉬운 값을 허용하되 형식은 고정
// 대문자 영숫자 4~8자 (웹에서 대문자로 정규화해 보낸다)
export class UpdateCheckInCodeDto implements IUpdateCheckInCodeDto {
  @Matches(/^[A-Z0-9]{4,8}$/, {
    message: '코드는 영문 대문자·숫자 4~8자여야 합니다.',
  })
  code: string;
}
