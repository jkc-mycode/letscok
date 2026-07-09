// 테스트 전용 DB 연결 문자열 — 개발 DB(letscok)와 분리해 truncate가 개발 데이터를 지우지 않게 한다
export const TEST_DATABASE_URL =
  'postgresql://letscok:letscok@localhost:5432/letscok_test';
