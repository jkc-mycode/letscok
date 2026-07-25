import { IUpdateCheckInCodeDto } from '@letscok/shared-types';
import { Matches } from 'class-validator';

// 체크인 코드 변경 요청 — 소모임 공지사항 작성월일(MMDD)을 쓰는 운영이라 숫자 4자리 고정
// 실수 방지용으로 형식만 검증한다(실제 월일인지까지는 안 따진다 — 운영진 재량)
export class UpdateCheckInCodeDto implements IUpdateCheckInCodeDto {
  @Matches(/^[0-9]{4}$/, {
    message: '코드는 숫자 4자리여야 합니다.',
  })
  code: string;
}
