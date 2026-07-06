import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // .env를 읽어 process.env에 채우는 담당 (Prisma CLI 쪽은 prisma.config.ts의 dotenv가 별도 담당)
    // isGlobal: 모든 모듈에서 ConfigModule 재import 없이 ConfigService 주입 가능
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // 앞으로 기능 모듈(members, sessions, courts, games...)이 여기에 추가된다
  ],
  controllers: [HealthController],
})
export class AppModule {}
