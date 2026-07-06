// Prisma CLI(migrate, generate, studio) 전용 설정 — 앱 런타임과는 무관
// 런타임 연결은 src/prisma/prisma.service.ts의 어댑터가 담당한다
import 'dotenv/config'; // 이 import가 실행되는 순간 .env가 process.env로 로드됨 (env() 호출보다 먼저여야 함)
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // Prisma 7부터 연결 URL은 스키마 파일이 아니라 여기서 설정
  // 마이그레이션은 pooled(PgBouncer) 연결에서 advisory lock이 막혀 P1002가 나므로
  // DIRECT_DATABASE_URL(비-pooler)이 있으면 그걸 우선 사용 — 런타임(prisma.service)은 계속 pooled
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? env('DATABASE_URL'),
  },
});
