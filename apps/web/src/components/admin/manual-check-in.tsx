'use client';

import { IAttendance, IMember } from '@letscok/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { AiCheckInPanel } from '@/components/ai-check-in-panel';
import { Sheet } from '@/components/sheet';
import { ClearableInput } from '@/components/clearable-input';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { SearchIcon } from '@/components/icons';
import { MultiMemberForm, NewMemberBody } from '@/components/multi-member-form';
import { api, ApiError } from '@/lib/api';

// 출석 추가 시트 — 이름 검색으로 출석, 신규 등록, AI 출석(소모임 캡처)

export function ManualCheckInModal({
  sessionId,
  attendances,
  run,
  busy,
  onClose,
}: {
  sessionId: string;
  attendances: IAttendance[];
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IMember[]>([]);
  // 선택 목록은 검색어가 바뀌어도 유지돼야 해서 결과 배열이 아닌 별도 Map으로 들고 간다
  const [selected, setSelected] = useState<Map<string, IMember>>(new Map());
  const [lastDone, setLastDone] = useState<string | null>(null); // 연속 입력용 직전 완료 표시
  const [failed, setFailed] = useState<{ name: string; message: string }[]>([]);
  // 신규 등록 폼 — 여러 명을 한 번에(공용 MultiMemberForm). 현장 대리 등록은 게스트가 흔해서 기본 게스트
  const [regOpen, setRegOpen] = useState(false);

  // 입력 후 300ms 조용하면 검색 (타이핑마다 요청하지 않도록 — /checkin과 동일 패턴)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<IMember[]>(`/members/search?name=${encodeURIComponent(trimmed)}`, { admin: true })
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 현재 세션 출석과 대조 — 이미 출석 중이면 탭 자체를 막아 쓸모없는 409를 없앤다
  const statusByMemberId = useMemo(
    () => new Map(attendances.map((a) => [a.memberId, a.status])),
    [attendances],
  );

  const toggle = (member: IMember) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(member.id)) next.set(member.id, member);
      return next;
    });

  // 선택한 인원을 한 번에 체크인 — 서버 엔드포인트가 1명 단위라 순차 호출한다
  // run()의 공통 에러 토스트는 첫 실패에서 끊기므로 여기서 개별로 잡아 성공/실패를 나눠 보고
  const checkInSelected = () => {
    const targets = [...selected.values()];
    if (targets.length === 0) return;
    void run(async () => {
      const errors: { name: string; message: string }[] = [];
      const remaining = new Map<string, IMember>();
      for (const member of targets) {
        try {
          await api(`/sessions/${sessionId}/attendances/manual`, {
            method: 'POST',
            admin: true,
            body: { memberId: member.id },
          });
        } catch (e) {
          errors.push({
            name: member.name,
            message: e instanceof ApiError ? e.message : '요청에 실패했습니다.',
          });
          remaining.set(member.id, member); // 실패한 사람만 선택으로 남겨 재시도하게
        }
      }
      setSelected(remaining);
      setFailed(errors);
      const okCount = targets.length - errors.length;
      // 모달은 열어둔다 — 지각 시나리오는 보통 여러 명 연속 입력
      setLastDone(okCount > 0 ? `${okCount}명 출석 완료` : null);
    });
  };

  // 한 명분 등록+체크인 — 개인정보 동의는 여기서 받지 않는다(대리 등록이라 본인 의사가 아님)
  // 본인이 코드로 처음 들어올 때 /checkin에서 동의를 받아 기록한다
  const registerAndCheckIn = async (body: NewMemberBody) => {
    const created = await api<IMember>('/members', { method: 'POST', admin: true, body });
    await api(`/sessions/${sessionId}/attendances/manual`, {
      method: 'POST',
      admin: true,
      body: { memberId: created.id },
    });
  };

  // 비슷한 이름 목록에서 기존 사람을 고르면 등록 없이 바로 체크인
  const checkInExisting = async (member: IMember) => {
    await api(`/sessions/${sessionId}/attendances/manual`, {
      method: 'POST',
      admin: true,
      body: { memberId: member.id },
    });
  };

  return (
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel="출석 추가"
      dismissible={false}
      onClose={onClose}
      width="sm:max-w-xl"
      // 높이 고정 — 검색 결과 수에 따라 시트가 커졌다 작아지지 않게
      height="h-[88dvh] sm:h-[min(720px,88dvh)]"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-heading font-bold whitespace-nowrap">
            {regOpen ? '신규 등록 + 출석' : '출석 추가'}
          </h2>
          <p className="min-w-0 truncate text-caption text-faint">
            {regOpen ? '검색에 없는 사람' : '사전 등록·현장 대리'}
          </p>
        </>
      }
      footer={
        regOpen ? (
          <button
            onClick={() => setRegOpen(false)}
            className="tap h-12 w-full rounded-xl bg-panel2 text-body-sm font-medium text-dim"
          >
            ‹ 검색으로 돌아가기
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setRegOpen(true)}
              className="tap h-13 shrink-0 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-sky"
            >
              + 신규 등록
            </button>
            <button
              onClick={checkInSelected}
              disabled={busy || selected.size === 0}
              className="tap h-13 flex-1 rounded-xl bg-court text-body font-bold text-bg disabled:bg-line disabled:text-faint"
            >
              {selected.size > 0 ? `${selected.size}명 출석` : '출석할 사람을 고르세요'}
            </button>
          </div>
        )
      }
    >
      {/* 머리글 아래 전체가 한 덩어리로 스크롤 — 검색 결과만 스크롤하면 AI 결과·선택 인원이
          커질 때 줄어들지 못하고 팝업 상자 밖으로 넘친다 */}
      <div className="flex min-h-0 flex-1 flex-col scroll-area">
        {lastDone && <p className="pb-2 text-body-sm font-medium text-court">{lastDone}</p>}
        {failed.length > 0 && (
          <div className="pb-2">
            {failed.map((f) => (
              <p key={f.name} className="text-body-sm font-medium text-coral">
                {f.name}님 실패 — {f.message}
              </p>
            ))}
          </div>
        )}

        {regOpen ? (
          // 신규 대리 등록 — 검색에 없는 인원을 즉석 등록+체크인 (기본 게스트)
          <div className="flex flex-col gap-3">
            <MultiMemberForm
              defaultGuest
              initialName={query.trim()} // 방금 검색한 이름 이어받기
              actionLabel="등록 + 출석"
              register={registerAndCheckIn}
              pickExisting={{ label: '이 사람 출석', action: checkInExisting }}
              onFinished={(done, remaining) => {
                // 체크인은 소켓 스냅샷으로 보드에 바로 반영된다 — 여기선 결과 문구만
                if (done.length > 0) setLastDone(`${done.join(', ')}님 출석 완료`);
                setFailed([]);
                if (remaining === 0) setRegOpen(false);
              }}
            />
            <p className="text-caption leading-relaxed text-faint">
              게스트는 생년월일을 받지 않아요. 모임원은 본인 폰에서 입장 코드를 넣으면 이 계정으로
              연결돼요. 등록은 본인에게 구두로 동의받아 주세요.
            </p>
          </div>
        ) : (
          <>
            {/* AI 체크인 — 접힌 한 줄, 서버에 AI 키가 없으면 스스로 숨는다 */}
            <AiCheckInPanel sessionId={sessionId} attendances={attendances} run={run} />

            <div className="relative shrink-0">
              <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-faint">
                <SearchIcon />
              </span>
              <ClearableInput
                autoComplete="off"
                enterKeyHint="search"
                aria-label="모임원 이름 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름으로 검색"
                className="h-12 rounded-xl border-2 border-transparent bg-panel2 pl-11 text-body outline-none placeholder:text-faint focus:border-court"
                onClear={() => setQuery('')}
              />
            </div>

            {/* 선택 인원 — 검색어를 바꿔도 남으므로 여기서 전체를 확인하고 해제할 수 있게 */}
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-3">
                {[...selected.values()].map((member) => (
                  <button
                    key={member.id}
                    onClick={() => toggle(member)}
                    aria-label={`${member.name} 선택 빼기`}
                    className="tap flex h-9 items-center gap-1.5 rounded-lg bg-court/10 px-3 text-body-sm font-medium text-court"
                  >
                    {member.name}
                    <span className="text-faint">✕</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-col gap-1">
              {results.map((member) => {
                const status = statusByMemberId.get(member.id);
                const present = status !== undefined && status !== 'LEFT';
                const picked = selected.has(member.id);
                return (
                  <button
                    key={member.id}
                    onClick={() => !present && toggle(member)}
                    disabled={present}
                    aria-pressed={picked}
                    className={`flex min-h-14 items-center gap-2.5 rounded-xl px-3 text-left ${
                      present ? 'bg-panel2 opacity-50' : picked ? 'bg-court/12' : 'bg-panel2'
                    }`}
                  >
                    <span
                      className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md text-caption font-bold ${
                        picked ? 'bg-court text-bg' : 'bg-line text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <GradeBadge grade={member.grade} />
                    <span className={`truncate text-body ${picked ? 'font-bold' : 'font-medium'}`}>{member.name}</span>
                    <GenderMarker gender={member.gender} />
                    {present && (
                      <span className="shrink-0 rounded bg-court/15 px-1.5 py-0.5 text-caption font-medium text-court">
                        출석 중
                      </span>
                    )}
                    {status === 'LEFT' && (
                      <span className="shrink-0 rounded bg-amber/15 px-1.5 py-0.5 text-caption font-medium text-amber">
                        퇴장 — 재입장
                      </span>
                    )}
                    {/* 동명이인 구분용 생년월일 */}
                    <span
                      className={`ml-auto shrink-0 text-caption ${
                        member.isGuest ? 'text-sky' : 'tabular font-mono text-dim'
                      }`}
                    >
                      {member.isGuest ? '게스트' : (member.birthDate ?? '생년월일 없음')}
                    </span>
                  </button>
                );
              })}
              {query.trim() && results.length === 0 && (
                <p className="py-6 text-center text-body-sm text-faint">
                  검색 결과가 없어요. 아래 [+ 신규 등록]으로 등록하면서 바로 출석 처리할 수 있어요.
                </p>
              )}
              {!query.trim() && (
                <p className="py-6 text-center text-body-sm text-faint">
                  이름으로 찾아 여러 명을 고른 뒤 한 번에 출석 처리해요
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
