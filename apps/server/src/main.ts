// dotenv를 가장 먼저 로드 — 게이트웨이 데코레이터(CORS)처럼 모듈 import 시점에
// 평가되는 코드가 env를 읽으므로 ConfigModule(부팅 후 로드)보다 앞서야 한다
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 브라우저(Vercel의 웹)가 다른 오리진인 백엔드(Render)로 요청할 수 있게 CORS 허용
  // 허용 목록은 환경변수로 관리 — 로컬은 localhost:3000, 배포 후엔 실제 도메인을 콤마로 추가
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  // 모든 요청 body를 DTO 기준으로 자동 검증
  // whitelist: DTO에 없는 필드는 조용히 제거 (예상 밖 필드 주입 방지)
  // transform: plain object를 DTO 클래스 인스턴스로 변환 (@Type, 기본형 캐스팅 동작)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Render는 자체적으로 PORT를 주입하므로 하드코딩하면 배포에서 죽는다 — 반드시 env 우선
  await app.listen(Number(process.env.PORT ?? 4000));
}

void bootstrap();
