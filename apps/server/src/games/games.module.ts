import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [SessionsModule], // 진행 중 세션 검증 재사용
  controllers: [GamesController],
  providers: [GamesService, RecommendationsService],
  exports: [RecommendationsService], // AI 운영 명령(게임 짜기)이 추천을 재사용
})
export class GamesModule {}
