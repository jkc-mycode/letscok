'use client';

// 체크인 진입점 — 코드 입력 후 이름 검색으로 본인 선택
// 코드는 소모임 공지사항의 작성월일(MMDD) — 모임원이 이미 보는 정보라 QR 없이 들어올 수 있다
// 자가 가입은 없다: 명단 등록은 운영진이 관제판에서 한다 (코드를 아는 외부인의 가짜 회원 생성 차단)
// 운영진이 대신 등록한 회원은 동의 이력이 없으므로 이 화면에서 본인 동의를 받는다
// 체크인 성공 시 memberId를 저장하고 내 상태 화면(/m)으로 이동

import { IAttendance, IMember } from '@letscok/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GenderMarker, GradeBadge, Toast } from '@/components/badges';
import { api, ApiError } from '@/lib/api';
import { saveMemberId } from '@/lib/member';
import { useSnapshot } from '@/lib/use-snapshot';

export default function CheckinPage() {
  const router = useRouter();
  // 숫자 4자리 — 서버도 같은 형식으로 검증하고, 틀리면 403(오입력 누적 시 429)
  const [inputCode, setInputCode] = useState('');
  const code = inputCode.length === 4 ? inputCode : null;
  const { snapshot, noSession, loading } = useSnapshot();
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkIn = async (member: IMember, consent: boolean) => {
    if (busy || !snapshot) return;
    setBusy(true);
    try {
      await api<IAttendance>(`/sessions/${snapshot.session.id}/attendances`, {
        method: 'POST',
        body: { memberId: member.id, code, ...(consent && { consent: true }) },
      });
      saveMemberId(member.id);
      router.replace('/m');
    } catch (e) {
      // 운영진이 미리 체크인해둔 경우도 본인 확인은 된 것 — 내 상태로 진입
      // (서버는 이 409보다 먼저 동의를 기록하므로 동의가 유실되지 않는다)
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
        <h1 className="mt-1 text-2xl font-bold">이름으로 체크인</h1>
      </header>

      {/* 코드 입력 — 소모임 공지사항 작성월일. 틀린 값은 서버가 막으므로 여기선 형식(숫자 4자리)만 맞춘다 */}
      <div className="rounded-xl border border-line bg-panel p-4">
        <p className="text-sm font-medium">코드 입력</p>
        <p className="mt-1 text-xs leading-relaxed text-dim">
          소모임에 있는 &lsquo;[필독]공지사항&rsquo;의 작성월일 4자리 입력하세요.
        </p>
        <input
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000"
          className="tabular mt-3 h-14 w-full rounded-lg border border-line bg-panel2 text-center font-mono text-2xl tracking-[0.4em] outline-none placeholder:text-faint focus:border-court"
        />
      </div>

      <SearchPanel busy={busy} hasCode={code !== null} onSelect={checkIn} />

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
  hasCode,
  onSelect,
}: {
  busy: boolean;
  hasCode: boolean;
  onSelect: (member: IMember, consent: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IMember[]>([]);
  const [selected, setSelected] = useState<IMember | null>(null);
  const [consent, setConsent] = useState(false);

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

  // 운영진 대리 등록분만 동의를 받는다 — 한 번 동의하면 다음 모임부턴 안 뜬다
  const needsConsent = selected !== null && !selected.consented;
  const blocked = !selected || !hasCode || busy || (needsConsent && !consent);

  return (
    <>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
          setConsent(false);
        }}
        placeholder="이름을 입력하세요"
        className="h-14 rounded-xl border border-line bg-panel px-5 text-lg outline-none focus:border-court"
      />

      <div className="flex flex-col gap-2">
        {results.map((member) => (
          <button
            key={member.id}
            onClick={() => {
              setSelected(member);
              setConsent(false);
            }}
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

      {/* 개인정보 수집 동의 — 운영진이 대신 등록했으므로 본인 확인 시점에 받는다 */}
      {needsConsent && (
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
      )}

      <button
        onClick={() => selected && void onSelect(selected, needsConsent)}
        disabled={blocked}
        className="h-14 rounded-xl bg-court text-lg font-bold text-bg disabled:bg-panel2 disabled:text-faint"
      >
        {!selected
          ? '본인을 선택해주세요'
          : !hasCode
            ? '코드 4자리를 입력해주세요'
            : needsConsent && !consent
              ? '동의 후 체크인할 수 있어요'
              : `${selected.name}(으)로 체크인`}
      </button>
      <p className="text-center text-sm text-dim">
        이름이 안 보이면 운영진에게 등록을 요청해주세요
      </p>
    </>
  );
}
