import {
  IUpdateCourtSharedDto,
  IUpdateCourtTurnDto,
} from '@letscok/shared-types';
import { IsBoolean } from 'class-validator';

// 공유 코트 설정/차례 변경 — 둘 다 boolean 하나뿐이라 한 파일에 둔다 (500줄 미만 분리 금지 원칙)
export class UpdateCourtSharedDto implements IUpdateCourtSharedDto {
  @IsBoolean({ message: '공유 여부를 지정해주세요.' })
  isShared: boolean;
}

export class UpdateCourtTurnDto implements IUpdateCourtTurnDto {
  @IsBoolean({ message: '차례를 지정해주세요.' })
  ourTurn: boolean;
}
