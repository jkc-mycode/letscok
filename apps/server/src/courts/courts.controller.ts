import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IApiResponse, ICourt } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { CourtsService } from './courts.service';
import { CreateCourtDto } from './dto/create-court.dto';

// 코트 등록/해제는 전부 운영진 작업
@Controller()
@UseGuards(AdminGuard)
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  @Post('sessions/:sessionId/courts')
  async register(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateCourtDto,
  ): Promise<IApiResponse<ICourt>> {
    return {
      success: true,
      data: await this.courtsService.register(sessionId, dto),
    };
  }

  @Delete('courts/:id')
  async remove(@Param('id') id: string): Promise<IApiResponse<ICourt>> {
    return { success: true, data: await this.courtsService.remove(id) };
  }
}
