import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IAdminMemo, IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreateMemoDto } from './dto/memo.dtos';
import { MemosService } from './memos.service';

// 운영 메모는 전부 운영진 전용 — 모임원 경로로는 어떤 형태로도 노출하지 않는다
@Controller('memos')
@UseGuards(AdminGuard)
export class MemosController {
  constructor(private readonly memosService: MemosService) {}

  @Get()
  async list(): Promise<IApiResponse<IAdminMemo[]>> {
    return { success: true, data: await this.memosService.list() };
  }

  @Post()
  async create(@Body() dto: CreateMemoDto): Promise<IApiResponse<IAdminMemo>> {
    return { success: true, data: await this.memosService.create(dto.content) };
  }

  // 전체 초기화 — 프론트에서 2탭 확인 후 호출. :id 라우트보다 먼저 선언해 'clear'가 id로 잡히지 않게
  @Delete('clear')
  async clear(): Promise<IApiResponse<{ deleted: number }>> {
    return { success: true, data: await this.memosService.clear() };
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<IApiResponse<IAdminMemo>> {
    return { success: true, data: await this.memosService.remove(id) };
  }
}
