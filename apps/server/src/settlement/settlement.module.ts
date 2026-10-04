import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

// 뒤풀이 정산 — 서버는 영수증 판독만 한다. 계산·저장은 하지 않는다(웹에서 즉시 계산, 기록 저장 안 함)
@Module({
  imports: [AiModule],
  controllers: [SettlementController],
  providers: [SettlementService],
})
export class SettlementModule {}
