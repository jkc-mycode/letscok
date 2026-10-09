import { IAiCheckInCommandDto, IAiCheckInLinkDto } from '@letscok/shared-types';
import { IsString, Length } from 'class-validator';

// 자연어 명령 body — 한두 문장이면 충분해서 짧게 제한(비용·남용 방지)
export class AiCheckInCommandDto implements IAiCheckInCommandDto {
  @IsString({ message: '명령을 입력해주세요.' })
  @Length(1, 200, { message: '명령은 1~200자로 입력해주세요.' })
  text: string;
}

// 소모임 표기 연결 + 출석
export class AiCheckInLinkDto implements IAiCheckInLinkDto {
  @IsString({ message: '모임원을 선택해주세요.' })
  memberId: string;

  @IsString({ message: '연결할 이름이 없어요.' })
  @Length(1, 30, { message: '연결할 이름은 1~30자여야 해요.' })
  alias: string;
}
