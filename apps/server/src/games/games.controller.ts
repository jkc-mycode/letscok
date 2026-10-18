import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IApiResponse,
  IFillCourtsResult,
  IGame,
  IGameRecommendation,
  IPushCallResult,
} from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import {
  AddGamePlayerDto,
  MoveGameSlotDto,
  AssignGameDto,
  CreateDraftGameDto,
  CreateGameDto,
  ReorderGamesDto,
  ReopenGameDto,
  RecommendGamesQueryDto,
  ReplaceGamePlayerDto,
} from './dto/game.dtos';
import { GameRosterService } from './game-roster.service';
import { GamesService } from './games.service';
import { RecommendationsService } from './recommendations.service';

// 조합·배정·종료·해체·순서 변경은 전부 운영진 작업
@Controller()
@UseGuards(AdminGuard)
export class GamesController {
  constructor(
    private readonly gamesService: GamesService,
    private readonly rosterService: GameRosterService,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  // 다음 게임 후보 조합 추천 — 계산만, 대기 추가는 기존 게임 생성 API 재사용
  @Get('sessions/:sessionId/game-recommendations')
  async recommend(
    @Param('sessionId') sessionId: string,
    @Query() query: RecommendGamesQueryDto,
  ): Promise<IApiResponse<IGameRecommendation[]>> {
    return {
      success: true,
      data: await this.recommendationsService.recommend(
        sessionId,
        query.category,
        query.fixed ? query.fixed.split(',').filter(Boolean) : [],
      ),
    };
  }

  @Post('sessions/:sessionId/games')
  async create(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateGameDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.rosterService.create(sessionId, dto) };
  }

  // 빈칸 있는 조합 시작 — 관제판에서 첫 사람을 새 조합 자리에 끌어다 놓을 때
  @Post('sessions/:sessionId/games/draft')
  async createDraft(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateDraftGameDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.rosterService.createDraft(sessionId, dto) };
  }

  // 대기 조합 전체 순서를 한 번에 (끌어서 순서 바꾸기)
  @Patch('sessions/:sessionId/games/order')
  async reorder(
    @Param('sessionId') sessionId: string,
    @Body() dto: ReorderGamesDto,
  ): Promise<IApiResponse<IGame[]>> {
    return { success: true, data: await this.rosterService.reorder(sessionId, dto) };
  }

  @Patch('games/:id/assign')
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignGameDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.assign(id, dto) };
  }

  // 빈 코트 채우기 — 빈 코트에 대기 조합을 순서대로 한 번에 배정(가능한 것만)
  @Post('sessions/:sessionId/fill-courts')
  async fillCourts(
    @Param('sessionId') sessionId: string,
  ): Promise<IApiResponse<IFillCourtsResult>> {
    return { success: true, data: await this.gamesService.fillCourts(sessionId) };
  }

  @Patch('games/:id/finish')
  async finish(@Param('id') id: string): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.finish(id) };
  }

  // 게임 중 → 대기 조합 복귀 (조합 유지, 게임 수 미집계)
  // 게임 중인 조합을 다른 빈 코트로 — 게임 시간은 그대로
  @Patch('games/:id/court')
  async moveCourt(@Param('id') id: string, @Body() dto: AssignGameDto): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.moveCourt(id, dto) };
  }

  // [게임 종료] 되돌리기 — 종료 직후 알림(원래 코트), 게임 기록 길게 누르기(고른 빈 코트)
  @Patch('games/:id/reopen')
  async reopen(@Param('id') id: string, @Body() dto: ReopenGameDto): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.reopen(id, dto.courtId) };
  }

  @Patch('games/:id/unassign')
  async unassign(@Param('id') id: string): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.unassign(id) };
  }

  @Patch('games/:id/cancel')
  async cancel(@Param('id') id: string): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.gamesService.cancel(id) };
  }

  // 코트 [다시 알림] — 배정 알림을 4명에게 다시 푸시
  @Post('games/:id/renotify')
  async renotify(@Param('id') id: string): Promise<IApiResponse<IPushCallResult>> {
    return { success: true, data: await this.gamesService.renotify(id) };
  }

  // 선수 교체 — 게임 중·대기 조합에서 한 명만 바꿈 (타이머·큐 순서 유지)
  @Patch('games/:id/players')
  async replacePlayer(
    @Param('id') id: string,
    @Body() dto: ReplaceGamePlayerDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.rosterService.replacePlayer(id, dto) };
  }

  // 대기 조합 빈칸에 한 명 넣기 — 4명이 차면 일반 조합(4명에게 알림)
  @Post('games/:id/players')
  async addPlayer(
    @Param('id') id: string,
    @Body() dto: AddGamePlayerDto,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.rosterService.addPlayer(id, dto) };
  }

  // 대기 조합에서 한 명 빼기(빈칸으로) — 아무도 안 남으면 조합 해체
  @Delete('games/:id/players/:attendanceId')
  async removePlayer(
    @Param('id') id: string,
    @Param('attendanceId') attendanceId: string,
  ): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.rosterService.removePlayer(id, attendanceId) };
  }

  // 게임 안 자리 옮기기(팀 바꾸기) — 대기 조합·게임 중 모두
  @Patch('games/:id/slots')
  async moveSlot(@Param('id') id: string, @Body() dto: MoveGameSlotDto): Promise<IApiResponse<IGame>> {
    return { success: true, data: await this.rosterService.moveSlot(id, dto) };
  }
}
