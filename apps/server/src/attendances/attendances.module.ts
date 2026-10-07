import { Module } from '@nestjs/common';
import { MemosModule } from '../memos/memos.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AttendancesController } from './attendances.controller';
import { AttendancesService } from './attendances.service';
import { PartnersService } from './partners.service';

@Module({
  imports: [SessionsModule, MemosModule], // 진행 중 세션 검증 재사용, 파트너 지정 메모
  controllers: [AttendancesController],
  providers: [AttendancesService, PartnersService],
  exports: [AttendancesService], // AI 체크인이 수동 체크인을 재사용
})
export class AttendancesModule {}
