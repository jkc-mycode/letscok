import { randomInt } from 'node:crypto';

// 현장 체크인 코드 생성 — 스캔이 기본이라 길이 부담 없고, 수동 폴백 시 읽어주기 쉽게 6자리
// 혼동 문자(0/O, 1/I/L) 제외 — 화이트보드에 적거나 불러줄 때 오인 방지
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export function generateCheckInCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}
