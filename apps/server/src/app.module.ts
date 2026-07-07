import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
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
    SentryModule.forRoot(), // 에러 수집 — 초기화 자체는 src/instrument.ts (DSN 없으면 비활성)
    // .env를 읽어 process.env에 채우는 담당 (Prisma CLI 쪽은 prisma.config.ts의 dotenv가 별도 담당)
    // isGlobal: 모든 모듈에서 ConfigModule 재import 없이 ConfigService 주입 가능
    ConfigModule.forRoot({ isGlobal: true }),
    // 전역 rate limit: IP당 분당 60회 — 정상 사용(보드 조작·체크인)엔 안 걸리는 수준
    // 민감 엔드포인트는 @Throttle로 개별 강화 (회원 등록 10/분, 패스코드 검증 5/분)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
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
  providers: [
    // 예상 밖 예외(500대)만 Sentry로 보고 — HttpException(우리의 4xx 정상 흐름)은 미전송
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // 모든 HTTP 요청에 rate limit 적용
  ],
})
export class AppModule {}
