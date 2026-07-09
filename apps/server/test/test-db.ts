// 테스트 전용 DB 연결 문자열 — 개발 DB(letscok)와 분리해 truncate가 개발 데이터를 지우지 않게 한다
// CI에서는 TEST_DATABASE_URL로 주입(서비스 컨테이너), 로컬에서는 Docker letscok-postgres 고정값
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://letscok:letscok@localhost:5432/letscok_test';
