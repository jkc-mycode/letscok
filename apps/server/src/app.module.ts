import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendancesModule } from './attendances/attendances.module';
import { AuthController } from './auth/auth.controller';
import { CourtsModule } from './courts/courts.module';
import { GamesModule } from './games/games.module';
import { HealthController } from './health/health.controller';
import { MembersModule } from './members/members.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [
    // .env를 읽어 process.env에 채우는 담당 (Prisma CLI 쪽은 prisma.config.ts의 dotenv가 별도 담당)
    // isGlobal: 모든 모듈에서 ConfigModule 재import 없이 ConfigService 주입 가능
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RealtimeModule,
    MembersModule,
    SessionsModule,
    AttendancesModule,
    CourtsModule,
    GamesModule,
    // 다음 단계: 실시간(Socket.IO) 게이트웨이
  ],
  controllers: [HealthController, AuthController],
})
export class AppModule {}
