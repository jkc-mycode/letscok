import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IApiResponse,
  IHistoryMemberStats,
  IHistoryRankingEntry,
  IHistorySessionDetail,
  IHistorySessionListResponse,
} from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { HistoryService } from './history.service';

// 히스토리/전적은 운영진 전용 (공개 범위 결정 2026-07-09)
@Controller('history')
@UseGuards(AdminGuard)
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('sessions')
  async listSessions(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<IApiResponse<IHistorySessionListResponse>> {
    return {
      success: true,
      // 음수·과대 값 방어 — 페이지네이션 파라미터는 신뢰하지 않는다
      data: await this.historyService.listSessions(
        Math.max(1, page),
        Math.min(50, Math.max(1, limit)),
      ),
    };
  }

  // 참여 랭킹 — months 생략 시 전체 누적, 지정 시 최근 N개월만
  @Get('ranking')
  async getRanking(
    @Query('months', new ParseIntPipe({ optional: true })) months?: number,
  ): Promise<IApiResponse<IHistoryRankingEntry[]>> {
    return {
      success: true,
      data: await this.historyService.getRanking(
        months ? Math.min(24, Math.max(1, months)) : undefined,
      ),
    };
  }

  @Get('sessions/:id')
  async getSessionDetail(
    @Param('id') id: string,
  ): Promise<IApiResponse<IHistorySessionDetail>> {
    return { success: true, data: await this.historyService.getSessionDetail(id) };
  }

  @Get('members/:id')
  async getMemberStats(
    @Param('id') id: string,
  ): Promise<IApiResponse<IHistoryMemberStats>> {
    return { success: true, data: await this.historyService.getMemberStats(id) };
  }
}
