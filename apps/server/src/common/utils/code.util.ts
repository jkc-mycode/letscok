import { randomInt } from 'node:crypto';

// 체크인 코드 생성 — 모임원이 소모임 공지사항의 작성월일(MMDD)을 그대로 입력하는 운영이라
// 형식을 숫자 4자리로 고정한다. 여기서 만드는 값은 운영진이 아직 코드를 정하지 않은
// 첫 세션용 임시값 — 실제로는 관제판에서 공지 월일로 바꿔 쓴다
export function generateCheckInCode(): string {
  return String(randomInt(10_000)).padStart(4, '0');
}
