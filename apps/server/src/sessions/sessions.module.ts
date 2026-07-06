import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService], // 체크인(attendances)에서 진행 중 세션 검증 재사용
})
export class SessionsModule {}
