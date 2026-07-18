// 생년월일 8자리 숫자 입력 공통 처리 — 가입 폼(/checkin)과 관제판 수동 등록이 함께 쓴다
// 캘린더 피커는 연도 이동이 불편해서(1997년까지 수백 번 클릭) 숫자 직접 입력 방식

// 표시용 포맷 — 4자리(년)·6자리(월) 지나면 하이픈 자동 삽입
export function formatBirthInput(raw: string): string {
  const only = raw.replace(/\D/g, '').slice(0, 8);
  if (only.length > 6) return `${only.slice(0, 4)}-${only.slice(4, 6)}-${only.slice(6)}`;
  if (only.length > 4) return `${only.slice(0, 4)}-${only.slice(4)}`;
  return only;
}

// 유효한 8자리면 YYYY-MM-DD, 아니면 '' (1930년~올해 범위)
export function parseBirthDate(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const currentYear = new Date().getFullYear();
  if (year < 1930 || year > currentYear) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
