import { Module } from '@nestjs/common';
import { MemosController } from './memos.controller';
import { MemosService } from './memos.service';

@Module({
  controllers: [MemosController],
  providers: [MemosService],
  exports: [MemosService], // 대회 연습 파트너 지정 기록
})
export class MemosModule {}
