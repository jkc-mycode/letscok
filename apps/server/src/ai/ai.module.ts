import { Module } from '@nestjs/common';
import { AiClient } from './ai.client';

// OpenRouter 클라이언트 공용 모듈 — AI 체크인·뒤풀이 영수증 정산이 같은 키·모델을 쓴다
@Module({
  providers: [AiClient],
  exports: [AiClient],
})
export class AiModule {}
