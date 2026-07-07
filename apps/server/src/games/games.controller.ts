import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IApiResponse, IGame, IGameRecommendation } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { AssignGameDto, CreateGameDto, UpdateGameOrderDto } from './dto/game.dtos';
import { GamesService } from './games.service';
import { RecommendationsService } from './recommendations.service';

// 조합·배정·종료·해체·순서 변경은 전부 운영진 작업
@Controller()
@UseGuards(AdminGuard)
export class GamesController {
  constructor(
    private readonly gamesService: GamesService,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  // 다음 게임 후보 조합 추천 — 계산만, 대기 추가는 기존 게임 생성 API 재사용
  @Get('sessions/:sessionId/game-recommendations')
  async recommend(
    @Param('sessionId') sessionId: string,
  ): Promise<IApiResponse<IGameRecommendation[]>> {
    return {
      success: true,
      data: await this.recommendationsService.recommend(sessionId),
    };
  }

  @Post('sessions/:sessionId/games')
  async create(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateGameDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.create(sessionId, dto) };
  }

  @Patch('games/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignGameDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.assign(id, dto) };
  }

  @Patch('games/:id/finish')
  async finish(@Param('id') id: string): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.finish(id) };
  }

  // 게임 중 → 대기 조합 복귀 (조합 유지, 게임 수 미집계)
  @Patch('games/:id/unassign')
  async unassign(@Param('id') id: string): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.unassign(id) };
  }

  @Patch('games/:id/cancel')
  async cancel(@Param('id') id: string): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.cancel(id) };
  }

  @Patch('games/:id/order')
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateGameOrderDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.updateOrder(id, dto) };
  }
}
