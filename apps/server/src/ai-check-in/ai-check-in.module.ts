import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AttendancesModule } from '../attendances/attendances.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AiCheckInController } from './ai-check-in.controller';
import { AiCheckInService } from './ai-check-in.service';

@Module({
  imports: [AiModule, SessionsModule, AttendancesModule], // 체크인은 기존 수동 체크인을 재사용
  controllers: [AiCheckInController],
  providers: [AiCheckInService],
  exports: [AiCheckInService], // AI 운영 명령의 체크인이 같은 규칙을 재사용
})
export class AiCheckInModule {}
