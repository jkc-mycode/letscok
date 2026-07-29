'use client';

import { useEffect, useState } from 'react';
import { HomeLink } from '@/components/home-link';
import { api, ApiError, clearPasscode, getPasscode, savePasscode } from '@/lib/api';

// 운영진 패스코드 게이트 — /admin과 /history 계열이 공유
// 저장된 패스코드(localStorage)가 있으면 바로 통과, 없으면 입력 화면

export function LoginGate({
  title,
  subtitle,
  onSuccess,
}: {
  title: string;
  subtitle?: string;
  onSuccess: () => void;
}) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    savePasscode(passcode); // api()가 저장된 값을 헤더로 보내므로 먼저 저장 후 검증
    try {
      await api('/auth/admin/verify', { method: 'POST', admin: true });
      onSuccess();
    } catch (e) {
      clearPasscode();
      setError(e instanceof ApiError ? e.message : '연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fade-in flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <HomeLink className="inline-block text-sm font-medium tracking-[0.3em] text-court transition-opacity hover:opacity-70">
          LETSCOK
        </HomeLink>
        <h1 className="mt-2 text-4xl font-bold">{title}</h1>
        <p className="mt-2 text-dim">{subtitle ?? '운영진 패스코드를 입력해주세요'}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="패스코드"
          className="h-14 rounded-xl border border-line bg-panel px-5 text-lg outline-none focus:border-court"
        />
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="h-14 rounded-xl bg-court text-lg font-bold text-bg disabled:opacity-50"
        >
          {busy ? '확인 중...' : '입장'}
        </button>
        {error && <p className="text-center text-sm text-coral">{error}</p>}
      </div>
    </main>
  );
}

// 자식을 패스코드 게이트로 감싸는 래퍼 — 읽기 전용 화면(/history)처럼
// 로그아웃 버튼이 필요 없는 곳용. /admin은 잠금 흐름 때문에 자체 상태를 유지한다
export function AdminGate({ title, children }: { title: string; children: React.ReactNode }) {
  // null = 판정 전 — localStorage는 클라이언트에만 있어 SSR 첫 렌더와 어긋나면
  // hydration 에러가 나므로 마운트 후에 읽는다
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setAuthed(Boolean(getPasscode()));
  }, []);

  if (authed === null) return null;
  if (!authed) return <LoginGate title={title} onSuccess={() => setAuthed(true)} />;
  return <>{children}</>;
}
