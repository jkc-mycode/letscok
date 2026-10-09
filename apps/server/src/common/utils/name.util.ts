// 이름 비교용 정규화 — 유니코드 조합형 통일(NFC), 공백·이모지 제거. AI가 읽은 이름·소모임 표기·회원 이름을 같은 잣대로 비교한다
export function normalizeName(name: string): string {
  return name.normalize('NFC').replace(/[\s\p{Extended_Pictographic}️‍]/gu, '');
}
