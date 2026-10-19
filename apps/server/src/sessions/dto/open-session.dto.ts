import { IOpenSessionDto } from '@letscok/shared-types';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// 모임 시작 요청 — 본문 없이 보내면 지금처럼 같은 날 종료한 모임을 다시 연다
export class OpenSessionDto implements IOpenSessionDto {
  @IsOptional()
  @IsBoolean()
  fresh?: boolean;

  // 동시에 여는 모임 이름(여복·남복) — 칩에 들어가니 짧게
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: '모임 이름은 10자까지예요.' })
  label?: string;
}
