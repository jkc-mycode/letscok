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

export class CreateGameDto implements ICreateGameDto {
  @IsArray()
  @ArrayMinSize(4, { message: '게임은 4명으로 구성해야 합니다.' })
  @ArrayMaxSize(4, { message: '게임은 4명으로 구성해야 합니다.' })
  @IsString({ each: true })
  attendanceIds: [string, string, string, string];
}

export class AssignGameDto implements IAssignGameDto {
  @IsString({ message: '배정할 코트를 선택해주세요.' })
  courtId: string;
}

export class UpdateGameOrderDto implements IUpdateGameOrderDto {
  @IsInt({ message: '순서 값이 올바르지 않습니다.' })
  @Min(1, { message: '순서는 1 이상이어야 합니다.' })
  queueOrder: number;
}
