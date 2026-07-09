import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-db';

// 테스트 시작 전 1회: 로컬 Docker postgres에 테스트 DB를 만들고 마이그레이션을 적용한다
export default function globalSetup(): void {
  try {
    // 이미 있으면 통과, 없으면 생성 (컨테이너 이름은 로컬 개발 환경 고정값)
    const exists = execSync(
      `docker exec letscok-postgres psql -U letscok -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='letscok_test'"`,
    )
      .toString()
      .trim();
    if (exists !== '1') {
      execSync('docker exec letscok-postgres createdb -U letscok letscok_test');
    }
  } catch {
    throw new Error(
      '테스트 DB 준비 실패 — 로컬 Docker postgres(letscok-postgres)가 실행 중인지 확인해주세요.',
    );
  }

  // 스키마를 테스트 DB에 반영 — prisma.config.ts가 DIRECT_DATABASE_URL을 우선 사용하므로 함께 덮어쓴다
  execSync('pnpm exec prisma migrate deploy', {
    cwd: `${__dirname}/..`,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: 'pipe',
  });
}
