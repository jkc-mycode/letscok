// 업로드 전 사진 줄이기 — 긴 변 1568px JPEG면 캡처·영수증 글자는 충분히 읽히고 수백 KB로 줄어든다
// (서버 한도 장당 1.5MB, Render 무료 인스턴스 메모리 보호 — AI 체크인·영수증 정산 공용)
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지를 변환하지 못했어요.'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}
