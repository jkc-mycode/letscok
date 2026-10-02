import { Global, Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';

// @Global: 게임·출석 서비스가 상태 변경 후 발송을 호출하므로 반복 import 제거 (RealtimeModule과 같은 방식)
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
