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
  IHistoryMemberGame,
  IHistoryMemberSessionPage,
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

  // 개인 출석 이력 — 전체를 최신순으로 쪽 단위(무한 스크롤)
  @Get('members/:id/sessions')
  async getMemberSessions(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<IApiResponse<IHistoryMemberSessionPage>> {
    return {
      success: true,
      data: await this.historyService.getMemberSessions(
        id,
        Math.max(1, page),
        Math.min(50, Math.max(1, limit)),
      ),
    };
  }

  // 개인 출석 이력의 한 날짜 — 그날 이 사람이 뛴 게임과 팀원·상대
  @Get('members/:id/sessions/:sessionId/games')
  async getMemberSessionGames(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ): Promise<IApiResponse<IHistoryMemberGame[]>> {
    return { success: true, data: await this.historyService.getMemberSessionGames(id, sessionId) };
  }
}
