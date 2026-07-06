import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [SessionsModule], // 진행 중 세션 검증 재사용
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
