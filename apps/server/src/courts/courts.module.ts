import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { CourtsController } from './courts.controller';
import { CourtsService } from './courts.service';

@Module({
  imports: [SessionsModule], // 진행 중 세션 검증 재사용
  controllers: [CourtsController],
  providers: [CourtsService],
})
export class CourtsModule {}
