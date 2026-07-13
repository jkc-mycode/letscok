import { ICreateMemoDto } from '@letscok/shared-types';
import { IsString, Length } from 'class-validator';

// 메모 추가 body — 한 줄 자유 텍스트
export class CreateMemoDto implements ICreateMemoDto {
  @IsString({ message: '메모 내용을 입력해주세요.' })
  @Length(1, 200, { message: '메모는 1~200자로 입력해주세요.' })
  content: string;
}
