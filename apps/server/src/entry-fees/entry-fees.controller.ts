import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { IApiResponse, IEntryFee } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { SetEntryPaidDto, UpdateEntryFeeDto } from './dto/entry-fee.dto';
import { EntryFeesService } from './entry-fees.service';

// 오늘의 입장비 — 계좌·납부 여부가 담겨 전부 운영진 전용
@Controller()
@UseGuards(AdminGuard)
export class EntryFeesController {
  constructor(private readonly entryFees: EntryFeesService) {}

  @Get('sessions/:id/entry-fee')
  async get(@Param('id') id: string): Promise<IApiResponse<IEntryFee>> {
    return { success: true, data: await this.entryFees.get(id) };
  }

  @Put('sessions/:id/entry-fee')
  async update(@Param('id') id: string, @Body() dto: UpdateEntryFeeDto): Promise<IApiResponse<IEntryFee>> {
    return { success: true, data: await this.entryFees.update(id, dto) };
  }

  @Patch('attendances/:id/entry-paid')
  async setPaid(@Param('id') id: string, @Body() dto: SetEntryPaidDto): Promise<IApiResponse<IEntryFee>> {
    return { success: true, data: await this.entryFees.setPaid(id, dto) };
  }
}
