import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global: 기능 모듈마다 PrismaModule을 imports에 반복 추가하지 않아도
// 어디서든 PrismaService를 주입받을 수 있게 한다 (전역 등록은 이 모듈 하나만)
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
