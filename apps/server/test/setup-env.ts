import { TEST_DATABASE_URL } from './test-db';

// 각 테스트 파일 로드 전에 실행 — PrismaService가 생성자에서 읽는 DATABASE_URL을 테스트 DB로 교체
process.env.DATABASE_URL = TEST_DATABASE_URL;
