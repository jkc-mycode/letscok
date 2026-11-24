import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IApiResponse, IBracketPreview, ITournament, ITournamentDetail } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import {
  CreateTournamentDto,
  ImportBracketDto,
  SetTournamentEntryDto,
  SetTournamentScoreDto,
  StartTournamentMatchDto,
} from './dto/tournament.dtos';
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

  // 입구 체크인과 되돌리기
  @Patch(':id/participants/:participantId/entry')
  async setEntry(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: SetTournamentEntryDto,
  ): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.setEntry(id, participantId, dto.entered) };
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

  // 점수 입력과 수정 — 같은 경로로 다시 보내면 고친다
  @Put(':id/matches/:matchId/score')
  async setScore(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: SetTournamentScoreDto,
  ): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.setScore(id, matchId, dto) };
  }

  // 점수 지우기 — 경기는 대기로 돌아간다
  @Delete(':id/matches/:matchId/score')
  async clearScore(@Param('id') id: string, @Param('matchId') matchId: string): Promise<IApiResponse<ITournamentDetail>> {
    return { success: true, data: await this.tournamentsService.clearScore(id, matchId) };
  }
}

// 로그인 없이 읽는 대회 현황 — 모임원 화면과 운영석 전광판이 쓴다
@Controller('tournaments')
export class TournamentLiveController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get('live')
  async live(): Promise<IApiResponse<ITournamentDetail | null>> {
    return { success: true, data: await this.tournamentsService.live() };
  }
}
