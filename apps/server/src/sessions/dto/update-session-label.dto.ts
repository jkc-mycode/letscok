import { IUpdateSessionLabelDto } from '@letscok/shared-types';
import { IsString, MaxLength } from 'class-validator';

// 모임 이름 바꾸기 — 빈 문자열이면 이름을 지운다
export class UpdateSessionLabelDto implements IUpdateSessionLabelDto {
  @IsString()
  @MaxLength(10, { message: '모임 이름은 10자까지예요.' })
  label: string;
}
