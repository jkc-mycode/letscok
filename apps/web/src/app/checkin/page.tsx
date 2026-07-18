'use client';

// QR 스캔 진입점 — 이름 검색으로 본인 선택 후 체크인, 처음이면 등록
// 체크인 성공 시 memberId를 저장하고 내 상태 화면(/m)으로 이동

import { Gender, Grade, IAttendance, IMember } from '@letscok/shared-types';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { GenderMarker, GradeBadge, Toast } from '@/components/badges';
import { api, ApiError } from '@/lib/api';
import { saveMemberId } from '@/lib/member';
import { useSnapshot } from '@/lib/use-snapshot';

const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F'];

// useSearchParams는 Suspense 경계 안에서만 안전 (App Router 프리렌더 대응)
export default function CheckinPage() {
  return (
    <Suspense
      fallback={<Shell><p className="text-center text-dim">불러오는 중...</p></Shell>}
    >
      <CheckinInner />
    </Suspense>
  );
}

function CheckinInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('c'); // 현장 QR이 실어준 오늘 코드 — 체크인 요청에 그대로 전달
  const { snapshot, noSession, loading } = useSnapshot();
  const [mode, setMode] = useState<'search' | 'register'>('search');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkIn = async (member: IMember) => {
    if (busy || !snapshot) return;
    setBusy(true);
    try {
      await api<IAttendance>(`/sessions/${snapshot.session.id}/attendances`, {
        method: 'POST',
        body: { memberId: member.id, code },
      });
      saveMemberId(member.id);
      router.replace('/m');
    } catch (e) {
      // QR 재스캔 등으로 이미 출석된 경우도 본인 확인은 된 것 — 내 상태로 진입
      if (e instanceof ApiError && e.status === 409) {
        saveMemberId(member.id);
        router.replace('/m');
        return;
      }
      setToast(e instanceof ApiError ? e.message : '체크인에 실패했습니다.');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Shell><p className="text-center text-dim">불러오는 중...</p></Shell>;
  }
  if (noSession) {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-2xl font-bold">아직 모임 전이에요</h1>
          <p className="mt-2 text-dim">운영진이 모임을 시작하면 체크인할 수 있어요</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="text-center">
        <Link
          href="/"
          className="inline-block text-xs font-medium tracking-[0.3em] text-court transition-opacity hover:opacity-70"
        >
          LETSCOK
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {mode === 'search' ? '이름으로 체크인' : '처음 오셨네요!'}
        </h1>
      </header>

      {/* 코드 없이 진입(바 URL·지난 QR) — 현장 QR로 유도. 체크인 시 서버도 403으로 막음 */}
      {!code && (
        <div className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-center text-sm text-amber">
          현장의 <b>오늘 QR</b>을 스캔해 들어와주세요
        </div>
      )}

      {mode === 'search' ? (
        <SearchPanel busy={busy} onSelect={checkIn} onRegister={() => setMode('register')} />
      ) : (
        <RegisterPanel busy={busy} onDone={checkIn} onBack={() => setMode('search')} />
      )}

      {toast && <Toast message={toast} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-6">
      {children}
    </main>
  );
}

// ===== 이름 검색 =====

function SearchPanel({
  busy,
  onSelect,
  onRegister,
}: {
  busy: boolean;
  onSelect: (member: IMember) => Promise<void>;
  onRegister: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IMember[]>([]);
  const [selected, setSelected] = useState<IMember | null>(null);

  // 입력 후 300ms 조용하면 검색 (타이핑마다 요청하지 않도록)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<IMember[]>(`/members/search?name=${encodeURIComponent(trimmed)}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        placeholder="이름을 입력하세요"
        className="h-14 rounded-xl border border-line bg-panel px-5 text-lg outline-none focus:border-court"
      />

      <div className="flex flex-col gap-2">
        {results.map((member) => (
          <button
            key={member.id}
            onClick={() => setSelected(member)}
            className={`flex items-center gap-2 rounded-xl border p-4 text-left ${
              selected?.id === member.id ? 'border-court bg-court/10' : 'border-line bg-panel'
            }`}
          >
            <GradeBadge grade={member.grade} />
            <span className="font-medium">{member.name}</span>
            <GenderMarker gender={member.gender} />
            {member.isGuest && <span className="text-[10px] text-sky">게스트</span>}
            {/* 동명이인 구분용 생년월일 노출 */}
            <span className="ml-auto text-sm text-dim">{member.birthDate}</span>
          </button>
        ))}
        {query.trim() && results.length === 0 && (
          <p className="py-4 text-center text-sm text-faint">검색 결과가 없어요</p>
        )}
      </div>

      <button
        onClick={() => selected && void onSelect(selected)}
        disabled={!selected || busy}
        className="h-14 rounded-xl bg-court text-lg font-bold text-bg disabled:bg-panel2 disabled:text-faint"
      >
        {selected ? `${selected.name}(으)로 체크인` : '본인을 선택해주세요'}
      </button>
      <button onClick={onRegister} className="text-sm text-dim underline underline-offset-4">
        처음이에요 — 새로 등록하기
      </button>
    </>
  );
}

// ===== 신규 등록 =====

function RegisterPanel({
  busy,
  onDone,
  onBack,
}: {
  busy: boolean;
  onDone: (member: IMember) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [birthInput, setBirthInput] = useState(''); // 화면 표시용 (자동 하이픈)
  const [grade, setGrade] = useState<Grade | null>(null);
  const [gender, setGender] = useState<Gender | null>(null); // 복식 종목용 — 필수
  const [isGuest, setIsGuest] = useState(false);
  const [consent, setConsent] = useState(false); // 개인정보 수집 동의 — 서버도 필수 검증
  const [error, setError] = useState<string | null>(null);

  // 캘린더 피커는 연도 이동이 불편해서(1997년까지 수백 번 클릭) 숫자 8자리 직접 입력 방식
  const digits = birthInput.replace(/\D/g, '');
  const birthDate = useMemo(() => {
    if (digits.length !== 8) return '';
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    const currentYear = new Date().getFullYear();
    if (year < 1930 || year > currentYear) return '';
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }, [digits]);

  const handleBirthChange = (raw: string) => {
    const only = raw.replace(/\D/g, '').slice(0, 8);
    // 4자리(년)·6자리(월) 지나면 하이픈 자동 삽입
    let formatted = only;
    if (only.length > 6) formatted = `${only.slice(0, 4)}-${only.slice(4, 6)}-${only.slice(6)}`;
    else if (only.length > 4) formatted = `${only.slice(0, 4)}-${only.slice(4)}`;
    setBirthInput(formatted);
  };

  const submit = async () => {
    if (!name.trim() || (!isGuest && !birthDate) || !grade || !gender || !consent || busy) return;
    setError(null);
    try {
      const member = await api<IMember>('/members', {
        method: 'POST',
        // 게스트는 생년월일 미수집 (게스트 정책) — 서버도 보내와도 무시
        body: {
          name: name.trim(),
          ...(isGuest ? {} : { birthDate }),
          grade,
          gender,
          isGuest,
          consent,
        },
      });
      await onDone(member); // 등록 즉시 체크인까지
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '등록에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름"
          className="h-14 rounded-xl border border-line bg-panel px-5 text-lg outline-none focus:border-court"
        />
        {/* 게스트 토글을 생년월일보다 위에 — 게스트는 생년월일 미수집이라 켜면 아래 입력란이 아예 안 나온다 */}
        <button
          onClick={() => setIsGuest((v) => !v)}
          className={`flex h-14 items-center justify-between rounded-xl border px-5 ${
            isGuest ? 'border-sky bg-sky/10' : 'border-line bg-panel'
          }`}
        >
          <span className={isGuest ? 'text-sky' : 'text-dim'}>게스트로 참여하면 눌러주세요</span>
          <span className="text-sm text-faint">{isGuest ? '게스트' : '정회원'}</span>
        </button>
        {!isGuest && (
        <div>
          <p className="mb-2 text-sm text-dim">
            생년월일 <span className="text-faint">— 동명이인 구분에 쓰여요</span>
          </p>
          <input
            type="text"
            inputMode="numeric"
            value={birthInput}
            onChange={(e) => handleBirthChange(e.target.value)}
            placeholder="8자리 숫자 (예: 19970312)"
            className="h-14 w-full rounded-xl border border-line bg-panel px-5 text-lg outline-none focus:border-court"
          />
          {digits.length === 8 && !birthDate && (
            <p className="mt-1 text-xs text-coral">날짜가 올바르지 않아요</p>
          )}
        </div>
        )}
        <div>
          <p className="mb-2 text-sm text-dim">급수</p>
          <div className="grid grid-cols-6 gap-2">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`h-12 rounded-xl border font-bold ${
                  grade === g ? 'border-court bg-court/15 text-court' : 'border-line bg-panel text-dim'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-dim">성별 <span className="text-faint">— 복식 조 편성에 쓰여요</span></p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setGender('MALE')}
              className={`h-12 rounded-xl border font-bold ${
                gender === 'MALE' ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel text-dim'
              }`}
            >
              ♂ 남
            </button>
            <button
              onClick={() => setGender('FEMALE')}
              className={`h-12 rounded-xl border font-bold ${
                gender === 'FEMALE' ? 'border-pink bg-pink/15 text-pink' : 'border-line bg-panel text-dim'
              }`}
            >
              ♀ 여
            </button>
          </div>
        </div>
      </div>

      {/* 개인정보 수집 동의 — 친목단체라 법적 의무는 아니나 모임원 신뢰용으로 명시 */}
      <button
        onClick={() => setConsent((v) => !v)}
        className={`rounded-xl border p-4 text-left ${
          consent ? 'border-court bg-court/10' : 'border-line bg-panel'
        }`}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
              consent ? 'border-court bg-court text-bg' : 'border-line text-transparent'
            }`}
          >
            ✓
          </span>
          개인정보 수집·이용에 동의합니다
        </span>
        <span className="mt-2 block pl-7 text-xs leading-relaxed text-dim">
          수집 항목: 이름, 생년월일, 급수, 성별 · 목적: 모임 출석·게임 배정 관리, 동명이인 구분 ·
          보관: 모임 운영 기간 (삭제 요청 시 운영진이 지체 없이 삭제)
        </span>
      </button>

      <button
        onClick={() => void submit()}
        disabled={!name.trim() || (!isGuest && !birthDate) || !grade || !gender || !consent || busy}
        className="h-14 rounded-xl bg-court text-lg font-bold text-bg disabled:bg-panel2 disabled:text-faint"
      >
        등록하고 체크인
      </button>
      <button onClick={onBack} className="text-sm text-dim underline underline-offset-4">
        이미 등록했어요 — 이름 검색으로
      </button>
      {error && <p className="text-center text-sm text-coral">{error}</p>}
    </>
  );
}
