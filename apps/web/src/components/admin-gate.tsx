'use client';

import { useEffect, useState } from 'react';
import { HomeLink } from '@/components/home-link';
import { InstallPrompt } from '@/components/install-prompt';
import { NetHop } from '@/components/logo-loader';
import {
  ADMIN_UNAUTHORIZED_EVENT,
  ApiError,
  API_URL,
  clearAdminLogin,
  hasAdminLogin,
  loginWithPasscode,
  saveAdminLogin,
  upgradeStoredPasscode,
} from '@/lib/api';

// 운영진 패스코드 게이트 — /admin과 /history 계열이 공유
// 저장된 출입증(또는 예전 방식의 패스코드)이 있으면 바로 통과, 없으면 입력 화면

// 게이트 판정 상태 — /admin과 AdminGate가 공유
// 저장값이 있다는 것만으로 통과시키므로, 서버가 그 값을 거부하면(api()가 401 이벤트를 쏨) 입력 화면으로 되돌린다
export function useAdminAuth() {
  // null = 판정 전 — localStorage는 클라이언트에만 있어 SSR 첫 렌더와 어긋나면
  // hydration 에러가 나므로 마운트 후에 읽는다
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rejected, setRejected] = useState(false);
  useEffect(() => {
    setAuthed(hasAdminLogin());
    const onUnauthorized = () => {
      setRejected(true);
      setAuthed(false);
    };
    // 패스코드 원문이 저장된 예전 기기는 출입증으로 바꾼다(다시 입력할 필요 없음)
    void upgradeStoredPasscode().then((result) => result === 'rejected' && onUnauthorized());
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  return {
    authed,
    // 저장값이 거부돼 돌아온 경우 입력 화면에 띄울 안내
    notice: rejected ? '로그인이 만료됐거나 패스코드가 바뀌었어요. 다시 입력해 주세요.' : undefined,
    login: () => {
      setRejected(false);
      setAuthed(true);
    },
    // 잠금 = 저장된 출입증까지 삭제해야 새로고침으로 재입장되지 않는 진짜 로그아웃
    logout: () => {
      clearAdminLogin();
      setAuthed(false);
    },
  };
}

export function LoginGate({
  title,
  subtitle,
  notice,
  onSuccess,
}: {
  title: string;
  subtitle?: string;
  notice?: string;
  onSuccess: () => void;
}) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);

  // 화면이 열리자마자 서버를 깨워 둔다 — Render 무료 인스턴스는 잠들면 깨는 데 보통 1분 남짓, 길면 몇 분
  // (패스코드를 입력하는 동안 기동이 진행돼 실제 대기가 줄어든다. 결과는 쓰지 않음)
  useEffect(() => {
    fetch(`${API_URL}/health`).catch(() => {});
  }, []);

  // 확인이 3초 넘게 걸리면 서버 기동 중이라고 알린다
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [busy]);

  const submit = async () => {
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 검증이 끝나기 전에 저장하면, 대기 중 새로고침 시 틀린 패스코드로 게이트를 통과한다
      // 출입증을 받으면 그것만 저장하고 패스코드 원문은 남기지 않는다
      saveAdminLogin(await loginWithPasscode(passcode), passcode);
      onSuccess();
    } catch (e) {
      clearAdminLogin();
      setError(e instanceof ApiError ? e.message : '연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    // 디자인 시스템: 왼쪽 정렬 큰 제목 + 면 입력칸, 주요 버튼 하나를 아래에
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-5 pt-2 pb-6">
      {/* 관제판 설치 안내 — 운영진이 /admin에 처음 들어오는 자리가 여기다
          (보드 안쪽은 화면이 빽빽해서 배너를 끼울 자리가 마땅치 않다) */}
      <InstallPrompt app="admin" />
      <HomeLink className="flex h-11 items-center self-start text-caption font-bold tracking-[0.3em] text-court transition-opacity hover:opacity-70">
        LETSCOK
      </HomeLink>
      <header className="flex flex-col gap-4">
        <AdminMark />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-display font-bold">{title}에 들어갈게요</h1>
          <p className="text-body text-dim">{subtitle ?? '운영진 패스코드를 입력해 주세요'}</p>
        </div>
      </header>
      <div className="flex flex-col gap-2.5">
        <label htmlFor="admin-passcode" className="text-body-sm font-bold text-dim">
          패스코드
        </label>
        {/* 비밀번호 필드가 아니라서 브라우저의 "비밀번호 저장" 팝업이 뜨지 않는다 — 가림은 .text-mask가 담당
            (autocomplete="off"만으로는 크롬이 비밀번호 필드의 저장 제안을 끄지 않는다) */}
        <input
          id="admin-passcode"
          type="text"
          name="letscok-admin-code"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="패스코드"
          className="text-mask h-14 rounded-xl border-2 border-transparent bg-panel px-4 text-heading outline-none placeholder:text-faint focus:border-court"
        />
        <p className="text-caption text-faint">한 번 들어오면 이 기기에서는 다시 묻지 않아요</p>
        {/* 새로 입력해 실패한 에러가 있으면 그쪽이 더 최신 정보라 안내는 숨긴다 */}
        {notice && !error && <p className="text-body-sm text-amber">{notice}</p>}
        {error && <p className="text-body-sm text-coral">{error}</p>}
      </div>
      <div className="mt-auto flex flex-col gap-3">
        {slow && (
          <div className="flex items-center gap-3 rounded-xl bg-panel px-4 py-3">
            <NetHop size={28} />
            <p className="text-body-sm text-dim">서버를 깨우는 중이에요. 최대 5분 정도 걸릴 수 있어요.</p>
          </div>
        )}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="h-14 rounded-xl bg-court text-body font-bold text-bg disabled:opacity-50"
        >
          {busy ? '확인하는 중…' : '입장'}
        </button>
      </div>
    </main>
  );
}

// 운영 앱 아이콘(초록 바탕 셔틀콕) — 입장 화면 머리. 홈 화면 아이콘과 같은 그림(lib/shuttle-icon.ts admin)
function AdminMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 100 100" fill="none" aria-hidden className="shrink-0">
      <rect width="100" height="100" rx="22" className="fill-court" />
      <g transform="translate(18 18) scale(0.64) rotate(-14 50 54)">
        <path d="M33 60 L22 22 Q50 10 78 22 L67 60 Z" className="fill-bg" />
        <path d="M27 37 Q50 31 73 37" className="stroke-court" strokeWidth="2" />
        <path d="M40 60 L32 19 M50 60 L50 14 M60 60 L68 19" className="stroke-court" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="32" y="57" width="36" height="8" rx="4" fill="#eaf3ed" />
        <path d="M34 64 a16 16 0 0 0 32 0 Z" className="fill-bg" />
      </g>
    </svg>
  );
}

// 자식을 패스코드 게이트로 감싸는 래퍼 — 읽기 전용 화면(/history)처럼
// 로그아웃 버튼이 필요 없는 곳용. /admin은 잠금 흐름 때문에 자체 상태를 유지한다
export function AdminGate({ title, children }: { title: string; children: React.ReactNode }) {
  const { authed, notice, login } = useAdminAuth();

  if (authed === null) return null;
  if (!authed) return <LoginGate title={title} notice={notice} onSuccess={login} />;
  return <>{children}</>;
}
