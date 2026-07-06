// 서버가 UTC(Render)에서 돌아도 "오늘"은 항상 한국 날짜여야 한다
// (UTC 기준으로는 한국 저녁 모임이 다음 날로 넘어가는 오차 발생)
export function todayKst(): Date {
  const kstDateString = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Seoul',
  }); // en-CA 로케일은 YYYY-MM-DD 형식을 보장
  return new Date(kstDateString);
}

// Prisma의 @db.Date(Date 객체)를 API 응답용 'YYYY-MM-DD' 문자열로 변환
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
