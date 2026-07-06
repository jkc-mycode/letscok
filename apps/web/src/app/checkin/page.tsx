'use client';

// QR 스캔 진입점 — 이름 검색으로 본인 선택 후 체크인, 처음이면 등록
// 체크인 성공 시 memberId를 저장하고 내 상태 화면(/m)으로 이동

import { Grade, IAttendance, IMember } from '@letscok/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GradeBadge, Toast } from '@/components/badges';
import { api, ApiError } from '@/lib/api';
import { saveMemberId } from '@/lib/member';
import { useSnapshot } from '@/lib/use-snapshot';

const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function CheckinPage() {
  const router = useRouter();
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
        body: { memberId: member.id },
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
        <p className="text-xs font-medium tracking-[0.3em] text-court">LETSCOK</p>
        <h1 className="mt-1 text-2xl font-bold">
          {mode === 'search' ? '이름으로 체크인' : '처음 오셨네요!'}
        </h1>
      </header>

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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-6">
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
  const [birthDate, setBirthDate] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !birthDate || !grade || busy) return;
    setError(null);
    try {
      const member = await api<IMember>('/members', {
        method: 'POST',
        body: { name: name.trim(), birthDate, grade, isGuest },
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
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          className="h-14 rounded-xl border border-line bg-panel px-5 text-lg text-ink outline-none focus:border-court [color-scheme:dark]"
        />
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
        <button
          onClick={() => setIsGuest((v) => !v)}
          className={`flex h-14 items-center justify-between rounded-xl border px-5 ${
            isGuest ? 'border-sky bg-sky/10' : 'border-line bg-panel'
          }`}
        >
          <span className={isGuest ? 'text-sky' : 'text-dim'}>게스트로 참여해요</span>
          <span className="text-sm text-faint">{isGuest ? '게스트' : '정회원'}</span>
        </button>
      </div>

      <button
        onClick={() => void submit()}
        disabled={!name.trim() || !birthDate || !grade || busy}
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
