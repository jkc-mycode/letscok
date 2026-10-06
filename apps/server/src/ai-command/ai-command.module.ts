import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiCheckInModule } from '../ai-check-in/ai-check-in.module';
import { GamesModule } from '../games/games.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AiCommandController } from './ai-command.controller';
import { AiCommandService } from './ai-command.service';

// AI 운영 명령 — 문장을 정해진 동작으로 읽고(AI), 대상 찾기·추천은 기존 규칙(서버), 실행은 웹이 확인 후 기존 API로
@Module({
  imports: [AiModule, SessionsModule, GamesModule, AiCheckInModule],
  controllers: [AiCommandController],
  providers: [AiCommandService],
})
export class AiCommandModule {}
