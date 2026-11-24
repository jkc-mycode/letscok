import { IBracketNamePick, ICreateTournamentDto, IImportBracketDto } from '@letscok/shared-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';

export class CreateTournamentDto implements ICreateTournamentDto {
  @IsString({ message: '대회 이름을 입력해주세요.' })
  @Length(1, 30, { message: '대회 이름은 1~30자로 입력해주세요.' })
  name: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '대회 날짜는 YYYY-MM-DD 형식이어야 합니다.' })
  date: string;
}

export class BracketNamePickDto implements IBracketNamePick {
  @IsString()
  @Length(1, 20)
  name: string;

  @IsString()
  @Length(1, 40)
  memberId: string;
}

// 대진표 붙여 넣기 body — 미리 보기와 등록이 같은 모양을 쓴다
export class ImportBracketDto implements IImportBracketDto {
  @IsString({ message: '대진표를 붙여 넣어 주세요.' })
  @Length(1, 20_000, { message: '대진표가 너무 길어요.' })
  text: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BracketNamePickDto)
  picks?: BracketNamePickDto[];
}
