import { Module } from '@nestjs/common';
import { TournamentLiveController, TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

@Module({
  controllers: [TournamentsController, TournamentLiveController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
