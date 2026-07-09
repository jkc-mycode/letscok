import type { Config } from 'jest';

// 상태 전이 통합 테스트 설정 — 로컬 Docker postgres의 전용 테스트 DB(letscok_test)를 사용
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts', // 테스트 DB 생성 + 마이그레이션
  setupFiles: ['<rootDir>/test/setup-env.ts'], // DATABASE_URL을 테스트 DB로 교체
  maxWorkers: 1, // 테스트들이 같은 DB를 공유(truncate)하므로 병렬 실행 금지
  testTimeout: 15000,
};

export default config;
