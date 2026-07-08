import {
  IAssignGameDto,
  ICreateGameDto,
  IUpdateGameOrderDto,
} from '@letscok/shared-types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Min,
} from 'class-validator';

// 조합 생성 요청 — 정확히 4명(중복은 서비스에서 별도 검증). 회원 id가 아니라 출석 id
export class CreateGameDto implements ICreateGameDto {
  @IsArray()
  @ArrayMinSize(4, { message: '게임은 4명으로 구성해야 합니다.' })
  @ArrayMaxSize(4, { message: '게임은 4명으로 구성해야 합니다.' })
  @IsString({ each: true })
  attendanceIds: [string, string, string, string];
}

// 코트 배정 요청 — 대기 조합을 올릴 코트 id
export class AssignGameDto implements IAssignGameDto {
  @IsString({ message: '배정할 코트를 선택해주세요.' })
  courtId: string;
}

// 대기 조합 순서 변경 — 클라이언트가 계산한 목표 queueOrder를 그대로 반영 (이웃과 맞교환)
export class UpdateGameOrderDto implements IUpdateGameOrderDto {
  @IsInt({ message: '순서 값이 올바르지 않습니다.' })
  @Min(1, { message: '순서는 1 이상이어야 합니다.' })
  queueOrder: number;
}
