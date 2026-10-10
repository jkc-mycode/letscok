import { ISetEntryPaidDto, IUpdateEntryFeeDto } from '@letscok/shared-types';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

// 입장비 설정 — 비우면(null) 아직 안 정함
export class UpdateEntryFeeDto implements IUpdateEntryFeeDto {
  @ValidateIf((dto: UpdateEntryFeeDto) => dto.fee !== null)
  @IsInt({ message: '금액은 숫자로 입력해주세요.' })
  @Min(0)
  @Max(1_000_000, { message: '금액이 너무 커요.' })
  fee: number | null;

  @IsOptional()
  @ValidateIf((dto: UpdateEntryFeeDto) => dto.payeeAttendanceId !== null)
  @IsString()
  payeeAttendanceId: string | null;

  @IsOptional()
  @ValidateIf((dto: UpdateEntryFeeDto) => dto.account !== null)
  @IsString()
  @Length(0, 60, { message: '계좌는 60자 이내로 입력해주세요.' })
  account: string | null;
}

export class SetEntryPaidDto implements ISetEntryPaidDto {
  @IsBoolean({ message: '받음 여부를 지정해주세요.' })
  paid: boolean;
}
