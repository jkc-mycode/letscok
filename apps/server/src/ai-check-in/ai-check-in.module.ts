import { Module } from '@nestjs/common';
import { AttendancesModule } from '../attendances/attendances.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AiCheckInController } from './ai-check-in.controller';
import { AiCheckInService } from './ai-check-in.service';
import { AiClient } from './ai.client';

@Module({
  imports: [SessionsModule, AttendancesModule], // 체크인은 기존 수동 체크인을 재사용
  controllers: [AiCheckInController],
  providers: [AiCheckInService, AiClient],
})
export class AiCheckInModule {}
