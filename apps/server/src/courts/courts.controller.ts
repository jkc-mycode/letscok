import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IApiResponse, ICourt } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { CourtsService } from './courts.service';
import { CreateCourtDto } from './dto/create-court.dto';
import {
  UpdateCourtSharedDto,
  UpdateCourtTurnDto,
} from './dto/update-court-shared.dto';

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

  // 공유 코트 지정/해제 — 다른 모임과 번갈아 쓰는 코트
  @Patch('courts/:id/shared')
  async setShared(
    @Param('id') id: string,
    @Body() dto: UpdateCourtSharedDto,
  ): Promise<IApiResponse<ICourt>> {
    return {
      success: true,
      data: await this.courtsService.setShared(id, dto.isShared),
    };
  }

  // 공유 코트 차례 변경 — 상대 게임 종료를 앱이 알 수 없어 운영진이 탭으로 알려준다
  @Patch('courts/:id/turn')
  async setTurn(
    @Param('id') id: string,
    @Body() dto: UpdateCourtTurnDto,
  ): Promise<IApiResponse<ICourt>> {
    return {
      success: true,
      data: await this.courtsService.setTurn(id, dto.ourTurn),
    };
  }

  @Delete('courts/:id')
  async remove(@Param('id') id: string): Promise<IApiResponse<ICourt>> {
    return { success: true, data: await this.courtsService.remove(id) };
  }
}
