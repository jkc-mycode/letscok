import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-db';

// 테스트 시작 전 1회: 테스트 DB를 준비하고 마이그레이션을 적용한다
export default function globalSetup(): void {
  // CI는 워크플로의 postgres 서비스가 DB까지 만들어주므로 생성 단계 생략
  if (!process.env.TEST_DATABASE_URL) {
    try {
      // 로컬: Docker 컨테이너에 테스트 DB가 없으면 생성 (컨테이너 이름은 로컬 개발 환경 고정값)
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
