import { ICreateCourtDto } from '@letscok/shared-types';
import { IsInt, Max, Min } from 'class-validator';

export class CreateCourtDto implements ICreateCourtDto {
  @IsInt({ message: '코트 번호를 입력해주세요.' })
  @Min(1, { message: '코트 번호는 1 이상이어야 합니다.' })
  @Max(99, { message: '코트 번호는 99 이하여야 합니다.' })
  courtNo: number;
}
