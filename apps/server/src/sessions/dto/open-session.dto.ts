import { IOpenSessionDto } from '@letscok/shared-types';
import { IsBoolean, IsOptional } from 'class-validator';

// 모임 시작 요청 — 본문 없이 보내면 지금처럼 같은 날 종료한 모임을 다시 연다
export class OpenSessionDto implements IOpenSessionDto {
  @IsOptional()
  @IsBoolean()
  fresh?: boolean;
}
