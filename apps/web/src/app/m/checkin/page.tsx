'use client';

// 체크인 진입점 — 코드 입력 후 이름 검색으로 본인 선택
// 코드는 소모임 공지사항의 작성월일(MMDD) — 모임원이 이미 보는 정보라 QR 없이 들어올 수 있다
// 자가 가입은 없다: 명단 등록은 운영진이 관제판에서 한다 (코드를 아는 외부인의 가짜 회원 생성 차단)
// 운영진이 대신 등록한 회원은 동의 이력이 없으므로 이 화면에서 본인 동의를 받는다
// 체크인 성공 시 memberId를 저장하고 내 상태 화면(/m)으로 이동
// 디자인 시스템: 큰 제목 + 면으로 구분한 입력, 아래 고정 주요 버튼 하나

import { IAttendance, IMember } from '@letscok/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GenderMarker, GradeBadge, Toast } from '@/components/badges';
import { ClearableInput } from '@/components/clearable-input';
import { ConnectionError } from '@/components/connection-error';
import { HomeLink } from '@/components/home-link';
import { InstallPrompt } from '@/components/install-prompt';
import { LogoLoader } from '@/components/logo-loader';
import { api, ApiError } from '@/lib/api';
import { saveMemberId } from '@/lib/member';
import { useSnapshot } from '@/lib/use-snapshot';
import { useToast } from '@/lib/use-toast';

export default function CheckinPage() {
  const router = useRouter();
  // 숫자 4자리 — 서버도 같은 형식으로 검증하고, 틀리면 403(오입력 누적 시 429)
  const [inputCode, setInputCode] = useState('');
  const code = inputCode.length === 4 ? inputCode : null;
  const { snapshot, noSession, failed, loading, refetch } = useSnapshot();
  const { toast, showToast } = useToast();
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
      showToast(e instanceof ApiError ? e.message : '출석에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Shell><LogoLoader className="flex-1" /></Shell>;
  }
  // 서버에 닿지 못하면 체크인 폼을 보여 줘도 눌러지지 않는다 — 오류 화면으로
  if (failed && !snapshot) {
    return (
      <Shell>
        <ConnectionError onRetry={refetch} />
      </Shell>
    );
  }
  if (noSession) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <h1 className="text-display font-bold">아직 모임 전이에요</h1>
          <p className="text-body text-dim">운영진이 모임을 시작하면 들어올 수 있어요</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-display font-bold">코드와 이름을 넣어 주세요</h1>
        {/* 운영진이 미리 체크인해 뒀으면 폰 연결만, 아니면 체크인까지 — 둘 다 이 한 번으로 끝난다 */}
        <p className="text-body text-dim">미리 출석돼 있으면 내 폰과 연결되고, 아니면 출석까지 돼요</p>
      </header>

      <CodeBoxes value={inputCode} onChange={setInputCode} />

      <SearchPanel busy={busy} hasCode={code !== null} onSelect={checkIn} />

      {toast && <Toast toast={toast} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fade-in mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-5 pt-2 pb-6">
      {/* 설치 안내는 /m뿐 아니라 여기에도 필요하다 — 구 /checkin 링크로 바로 들어오는 사람이 있고,
          무엇보다 카톡 인앱 브라우저에서 체크인하면 memberId가 카톡 저장소에만 남아
          나중에 앱·사파리로 열었을 때 "체크인이 필요해요"가 뜬다 */}
      <InstallPrompt />
      <HomeLink className="flex h-11 items-center self-start text-caption font-bold tracking-[0.3em] text-court transition-opacity hover:opacity-70">
        LETSCOK
      </HomeLink>
      {children}
    </main>
  );
}

// 코드 입력 — 실제 입력칸은 하나(붙여넣기·자동 채우기·지우기가 평소처럼 동작), 보이는 모양만 4칸
// 투명한 입력칸을 4칸 위에 겹쳐 두고, 칸마다 숫자를 그린다. 지금 입력할 칸은 초록 테두리
// 틀린 값은 서버가 막으므로 여기선 형식(숫자 4자리)만 맞춘다
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor="checkin-code" className="text-body-sm font-bold text-dim">
        입장 코드
      </label>
      <div className="relative">
        <div className="grid grid-cols-4 gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => {
            const active = focused && (i === value.length || (i === 3 && value.length === 4));
            return (
              <span
                key={i}
                className={`tabular flex h-15 items-center justify-center rounded-xl bg-panel font-mono text-[1.625rem] font-semibold transition-shadow ${
                  active ? 'ring-2 ring-court' : ''
                }`}
              >
                {value[i] ?? ''}
              </span>
            );
          })}
        </div>
        <input
          id="checkin-code"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          aria-label="입장 코드 4자리"
          className="absolute inset-0 h-full w-full cursor-pointer text-transparent caret-transparent opacity-0"
        />
      </div>
      <p className="text-caption text-faint">소모임 [필독]공지사항의 작성월일 4자리예요</p>
    </div>
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
      <div className="flex flex-col gap-2.5">
        <label htmlFor="checkin-name" className="text-body-sm font-bold text-dim">
          이름
        </label>
        <ClearableInput
          id="checkin-name"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setConsent(false);
          }}
          placeholder="이름을 입력하세요"
          className="h-14 rounded-xl border-2 border-transparent bg-panel px-4 text-heading font-medium outline-none placeholder:text-faint focus:border-court"
          onClear={() => {
            setQuery('');
            setSelected(null);
            setConsent(false);
          }}
        />

        {results.length > 0 && (
          <div className="flex flex-col rounded-2xl bg-panel p-1.5">
            {results.map((member) => {
              const isSelected = selected?.id === member.id;
              return (
                <button
                  key={member.id}
                  onClick={() => {
                    setSelected(member);
                    setConsent(false);
                  }}
                  className={`flex h-14 items-center gap-2.5 rounded-xl px-3 text-left ${isSelected ? 'bg-court/12' : ''}`}
                >
                  <GradeBadge grade={member.grade} />
                  <span className={`min-w-0 truncate text-body ${isSelected ? 'font-bold' : 'font-medium'}`}>
                    {member.name}
                  </span>
                  <GenderMarker gender={member.gender} />
                  {member.isGuest && <span className="shrink-0 text-caption text-sky">게스트</span>}
                  {/* 동명이인 구분용 출생 연도 — 공개 응답엔 생년월일 전체가 오지 않는다 */}
                  <span className="tabular ml-auto font-mono text-body-sm text-dim">
                    {member.birthYear ? `${String(member.birthYear).slice(2)}년생` : ''}
                  </span>
                  <CheckIcon className={isSelected ? 'text-court' : 'text-transparent'} />
                </button>
              );
            })}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <p className="rounded-2xl bg-panel p-5 text-center text-body-sm text-faint">검색 결과가 없어요</p>
        )}
      </div>

      {/* 개인정보 수집 동의 — 운영진이 대신 등록했으므로 본인 확인 시점에 받는다 */}
      {needsConsent && (
        <button
          onClick={() => setConsent((v) => !v)}
          className={`rounded-2xl p-4 text-left whitespace-normal ${consent ? 'bg-court/12' : 'bg-panel'}`}
        >
          <span className="flex items-center gap-2.5 text-body font-bold">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                consent ? 'bg-court text-bg' : 'bg-panel2 text-transparent'
              }`}
            >
              <CheckIcon />
            </span>
            개인정보 수집·이용에 동의합니다
          </span>
          <span className="mt-2 block pl-8.5 text-caption leading-relaxed text-dim">
            수집 항목: 이름, 생년월일, 급수, 성별 · 목적: 모임 출석·게임 배정 관리, 동명이인 구분 ·
            보관: 모임 운영 기간 (삭제 요청 시 운영진이 지체 없이 삭제)
          </span>
        </button>
      )}

      {/* 주요 버튼 하나 — 화면 아래에 붙어 있어 검색 결과가 길어도 바로 누를 수 있다 */}
      <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-3 bg-bg/95 px-5 pt-3 pb-[calc(var(--safe-bottom)+0.25rem)] backdrop-blur">
        <button
          onClick={() => selected && void onSelect(selected, needsConsent)}
          disabled={blocked}
          className="min-h-14 rounded-xl bg-court px-3 text-body font-bold whitespace-normal text-bg disabled:bg-panel disabled:text-faint"
        >
          {!selected
            ? '본인을 선택해주세요'
            : !hasCode
              ? '코드 4자리를 입력해주세요'
              : needsConsent && !consent
                ? '동의 후 출석할 수 있어요'
                : `${selected.name}(으)로 들어가기`}
        </button>
        <p className="text-center text-caption text-faint">이름이 안 보이면 운영진에게 등록을 요청해 주세요</p>
      </div>
    </>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
