import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IApiResponse, IBracketPreview, ITournament, ITournamentDetail } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreateTournamentDto, ImportBracketDto, StartTournamentMatchDto } from './dto/tournament.dtos';
import { TournamentsService } from './tournaments.service';

// 대회 준비와 진행은 전부 운영진 전용 — 모임원이 보는 대회 현황은 공개 경로를 따로 둔다
@Controller('tournaments')
@UseGuards(AdminGuard)
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Post()
  async create(@Body() dto: CreateTournamentDto): Promise<IApiResponse<ITournament>> {
    return { success: true, data: await this.tournamentsService.create(dto) };
  }

  @Get('current')
  async current(): Promise<IApiResponse<ITournamentDetail | null>> {
    return { success: true, data: await this.tournamentsService.current() };
  }

  // 등록하지 않고 읽은 결과와 경고만 돌려준다
  @Post(':id/bracket/preview')
  async previewBracket(@Param('id') id: string, @Body() dto: ImportBracketDto): Promise<IApiResponse<IBracketPreview>> {
    return { success: true, data: await this.tournamentsService.previewBracket(id, dto) };
  }

  @Put(':id/bracket')
  async importBracket(@Param('id') id: string, @Body() dto: ImportBracketDto): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.importBracket(id, dto) };
  }

  @Post(':id/open')
  async open(@Param('id') id: string): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.open(id) };
  }

  @Post(':id/close')
  async close(@Param('id') id: string): Promise<IApiResponse<ITournament>> {
    return { success: true, data: await this.tournamentsService.close(id) };
  }

  @Post(':id/matches/:matchId/start')
  async startMatch(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: StartTournamentMatchDto,
  ): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.startMatch(id, matchId, dto) };
  }

  // 잘못 올린 경기를 대기로
  @Post(':id/matches/:matchId/cancel-start')
  async cancelStart(@Param('id') id: string, @Param('matchId') matchId: string): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.cancelStart(id, matchId) };
  }
}
