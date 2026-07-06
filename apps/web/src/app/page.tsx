import Link from 'next/link';

// 임시 허브 — QR은 추후 /checkin(모임원 체크인)으로 직접 연결된다
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-sm font-medium tracking-[0.3em] text-court">LETSCOK</p>
        <h1 className="mt-2 text-4xl font-bold">렛츠콕 🏸</h1>
      </div>
      <div className="flex gap-3">
        <Link
          href="/admin"
          className="flex h-14 items-center rounded-xl bg-court px-8 font-bold text-bg"
        >
          운영진 관제판
        </Link>
        <span className="flex h-14 items-center rounded-xl border border-line px-8 text-dim">
          모임원 체크인 (준비 중)
        </span>
      </div>
    </main>
  );
}
