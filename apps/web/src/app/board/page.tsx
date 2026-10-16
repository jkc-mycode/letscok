import { redirect } from 'next/navigation';

// 전광판은 관제판 앱 영역(/admin) 안으로 옮겼다 — 예전 주소로 띄워 둔 기기·북마크용
export default function LegacyBoardRedirect() {
  redirect('/admin/board');
}
