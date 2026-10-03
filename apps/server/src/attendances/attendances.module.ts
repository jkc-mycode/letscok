import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AttendancesController } from './attendances.controller';
import { AttendancesService } from './attendances.service';

@Module({
  imports: [SessionsModule], // 진행 중 세션 검증 재사용
  controllers: [AttendancesController],
  providers: [AttendancesService],
  exports: [AttendancesService], // AI 체크인이 수동 체크인을 재사용
})
export class AttendancesModule {}
