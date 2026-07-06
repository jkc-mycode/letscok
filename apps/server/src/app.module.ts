import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendancesModule } from './attendances/attendances.module';
import { HealthController } from './health/health.controller';
import { MembersModule } from './members/members.module';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [
    // .env를 읽어 process.env에 채우는 담당 (Prisma CLI 쪽은 prisma.config.ts의 dotenv가 별도 담당)
    // isGlobal: 모든 모듈에서 ConfigModule 재import 없이 ConfigService 주입 가능
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MembersModule,
    SessionsModule,
    AttendancesModule,
    // 다음 단계: CourtsModule, GamesModule, 실시간(Socket.IO) 게이트웨이
  ],
  controllers: [HealthController],
})
export class AppModule {}
