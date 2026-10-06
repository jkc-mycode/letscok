import { IAiCommandDto } from '@letscok/shared-types';
import { IsString, Length } from 'class-validator';

// 글·음성 명령 — 한두 문장이면 충분해서 짧게 제한(비용·남용 방지, 체크인 명령과 같은 기준)
export class AiCommandDto implements IAiCommandDto {
  @IsString({ message: '명령을 입력해주세요.' })
  @Length(1, 200, { message: '명령은 1~200자로 입력해주세요.' })
  text: string;
}
