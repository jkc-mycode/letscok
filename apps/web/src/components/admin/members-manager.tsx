'use client';

import {
  IMemberPage,
  IMemberSummary,
  MemberListFilter,
  MemberListSort,
  MemberRole,
} from '@letscok/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MemberSessionHistorySheet } from '@/components/member-session-history-sheet';
import { Sheet } from '@/components/sheet';
import { ClearableInput } from '@/components/clearable-input';
import { GenderMarker, GradeBadge, Toast } from '@/components/badges';
import { MultiMemberForm } from '@/components/multi-member-form';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/use-toast';
import { SearchIcon } from '@/components/icons';
import { MemberEditSheet, ROLE_LABEL, formatLastAttended } from '@/components/admin/member-edit-sheet';

// 모임원 관리 — 탭·검색·정렬 목록(무한 스크롤), 신규 등록, 오래 안 온 게스트 정리
// 명단 조회·수정·정리 — 자가 가입을 막은 대가로 명단 관리가 전적으로 운영진 책임이라 이 화면이 필요하다
// 세션과 무관한 회원 원장 작업이라 Board 밖(StartScreen)에서도 열 수 있게 스냅샷·run에 의존하지 않는다

const STALE_GUEST_DAYS = 90; // 정리 안내 문구용 — 판정은 서버(members.service STALE_GUEST_DAYS)와 같은 값

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === 'MEMBER') return null; // 대다수가 모임원 — 배지는 예외(모임장·운영진)만
  return (
    <span
      className={`min-w-0 truncate rounded px-1.5 py-0.5 text-caption font-medium ${
        role === 'LEADER' ? 'bg-amber/15 text-amber' : 'bg-court/15 text-court'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

const SORT_OPTIONS: { value: MemberListSort; label: string }[] = [
  { value: 'RECENT', label: '최근 출석순' },
  { value: 'NAME', label: '이름순' },
  { value: 'ATTENDANCE', label: '출석 많은 순' },
  { value: 'CREATED', label: '최근 등록순' },
  { value: 'GRADE', label: '급수 순' },
];

export function MembersManagerModal({ onClose }: { onClose: () => void }) {
  // 서버가 탭·검색에 맞는 100명씩 + 탭별 전체 인원을 준다(모임원이 늘어도 가볍게)
  const [data, setData] = useState<IMemberPage | null>(null); // null=첫 로딩
  const [staleGuests, setStaleGuests] = useState<IMemberSummary[]>([]);
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState(''); // 입력이 300ms 멈춘 뒤의 검색어 — 타이핑마다 요청하지 않게
  const [filter, setFilter] = useState<MemberListFilter>('ALL');
  const [sort, setSort] = useState<MemberListSort>('RECENT');
  const [pages, setPages] = useState(1); // 지금까지 이어 받은 쪽 수 — 끝까지 내리면 하나씩 늘어난다
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef(0); // 탭·검색이 바뀐 뒤 늦게 온 이전 응답을 버리려고
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<IMemberSummary | null>(null);
  const [historyTarget, setHistoryTarget] = useState<IMemberSummary | null>(null); // 전체 출석 이력 — 수정 시트 위에 겹쳐 뜬다
  const [registerOpen, setRegisterOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const { toast, showToast } = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const fetchPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams({ filter, sort, page: String(page), ...(keyword && { q: keyword }) });
      return api<IMemberPage>(`/members/page?${params}`, { admin: true });
    },
    [filter, sort, keyword],
  );

  // 첫 쪽부터 count쪽까지 다시 받아 이어 붙인다 — 수정·등록 뒤에도 보던 범위(스크롤 위치)가 유지되게
  const reload = useCallback(
    async (count: number) => {
      const id = ++requestRef.current;
      try {
        const stale = api<IMemberSummary[]>('/members/stale-guests', { admin: true });
        const chunks = await Promise.all(Array.from({ length: count }, (_, i) => fetchPage(i + 1)));
        const staleList = await stale;
        if (id !== requestRef.current) return;
        setData({ ...chunks[chunks.length - 1], items: chunks.flatMap((c) => c.items) });
        setPages(count);
        setStaleGuests(staleList);
      } catch {
        if (id === requestRef.current) showToast('명단을 불러오지 못했습니다.');
      }
    },
    [fetchPage, showToast],
  );
  // 탭·검색어·정렬이 바뀌면 첫 쪽부터, 목록도 맨 위로
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    void reload(1);
  }, [reload]);
  const refetch = () => reload(pages);

  const hasMore = data !== null && data.items.length < data.total;
  // 다음 100명 — 목록 끝 표시(sentinel)가 보이면 부른다
  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const id = requestRef.current;
    setLoadingMore(true);
    try {
      const next = await fetchPage(pages + 1);
      if (id !== requestRef.current) return;
      setData((prev) => prev && { ...next, items: [...prev.items, ...next.items] });
      setPages(pages + 1);
    } catch {
      showToast('명단을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  // 불러온 뒤에도 끝 표시가 아직 보이면(목록이 짧은 화면) 바로 한 번 더 — 다시 관찰을 걸면 즉시 알려 준다
  const loadedCount = data?.items.length ?? 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && void loadMoreRef.current(),
      { root: listRef.current, rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadedCount]);

  // 모달 전용 실행기 — Board의 run은 스냅샷 refetch까지 묶여 있어 세션 없는 화면에선 못 쓴다
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refetch();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const visible = data?.items ?? [];

  // 탭 숫자는 검색과 상관없이 진짜 전체 인원(서버 counts)
  const FILTER_TABS: { value: MemberListFilter; label: string }[] = [
    { value: 'ALL', label: '전체' },
    { value: 'REGULAR', label: '모임원' },
    { value: 'GUEST', label: '게스트' },
    { value: 'DELETED', label: '삭제됨' },
  ];

  return (
    // 안에서 여는 시트·알림은 시트 바깥에 둔다 — 시트는 움직이는(transform) 상자라 그 안의 fixed 요소는 위치가 깨진다
    <>
      <Sheet
        ariaLabel="모임원 관리"
        onClose={onClose}
        width="sm:max-w-3xl"
        // 높이 고정 — 검색 결과 수에 따라 시트가 커졌다 작아지지 않게
        height="h-[88dvh] sm:h-[min(720px,88dvh)]"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        header={
          <>
            <h2 className="shrink-0 text-heading font-bold whitespace-nowrap">모임원 관리</h2>
            {data && <span className="tabular font-mono text-body-sm text-faint">{data.counts.ALL}명</span>}
          </>
        }
        footer={
          <div className="flex items-center gap-2">
            {/* 등록 — 체크인 없이 명단에만 추가 (모임 전 사전 등록용). 모임 중 즉석 등록+체크인은 [수동 체크인]의 [신규 등록] */}
            <button
              onClick={() => setRegisterOpen(true)}
              className="tap h-12 flex-1 rounded-xl bg-court text-body font-bold text-bg sm:ml-auto sm:flex-none sm:px-6"
            >
              + 신규 등록
            </button>
          </div>
        }
      >
        <div className="relative shrink-0">
          <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-faint">
            <SearchIcon />
          </span>
          <ClearableInput
            autoComplete="off"
            enterKeyHint="search"
            aria-label="이름으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름으로 검색"
            className="h-12 rounded-xl border-2 border-transparent bg-panel2 pl-11 text-body outline-none placeholder:text-faint focus:border-court"
            onClear={() => setQuery('')}
          />
        </div>
        <div className="mt-3 flex shrink-0 gap-1.5 overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              aria-pressed={filter === tab.value}
              className={`tap h-9 shrink-0 rounded-lg px-3 text-body-sm ${
                filter === tab.value ? 'bg-court/15 font-bold text-court' : 'bg-panel2 text-dim'
              }`}
            >
              {tab.label}
              {data && <span className="tabular ml-1 font-mono font-medium">{data.counts[tab.value]}</span>}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center pt-2 pb-2">
          <span className="text-caption text-faint">
            {data ? `${keyword ? '검색 결과 ' : ''}${data.total}명` : ''}
          </span>
          {/* 폰에선 OS 선택 창이 떠서 고르기 쉽다 — 글자처럼 보이게만 꾸민다 */}
          <label className="relative ml-auto flex items-center text-body-sm text-dim">
            <span className="sr-only">정렬</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as MemberListSort)}
              className="h-9 appearance-none bg-transparent pr-6 pl-2 text-right outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </label>
        </div>

        {/* 오래 안 온 게스트 정리 — 게스트 탭에서만, 목록 바로 위 */}
        {filter === 'GUEST' && staleGuests.length > 0 && (
          <div className="mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-amber/10 py-2 pr-2 pl-3.5">
            <span className="min-w-0 text-body-sm text-amber">
              {STALE_GUEST_DAYS}일 넘게 안 온 게스트 <b>{staleGuests.length}명</b>
            </span>
            <button
              onClick={() => setCleanupOpen(true)}
              className="tap ml-auto h-9 shrink-0 rounded-lg bg-amber px-3 text-body-sm font-bold text-bg"
            >
              정리하기
            </button>
          </div>
        )}

        {/* 남는 높이를 다 쓰고 이 안에서만 스크롤 — 태블릿도 한 줄에 한 명(두 칸이면 카드가 좁아 정보가 겹친다) */}
        <div
          ref={listRef}
          className="flex min-h-0 flex-1 flex-col gap-1.5 scroll-area"
        >
          {data === null && <p className="py-8 text-center text-body-sm text-dim">불러오는 중...</p>}
          {data !== null && visible.length === 0 && (
            <p className="py-8 text-center text-body-sm text-faint">
              {keyword ? '검색 결과가 없어요' : filter === 'DELETED' ? '삭제된 모임원이 없어요' : '아직 아무도 없어요'}
            </p>
          )}
          {visible.map((member) => (
            <button
              key={member.id}
              onClick={() => setEditTarget(member)}
              className={`flex min-h-15 items-center gap-2.5 rounded-xl bg-panel2 px-3 py-2.5 text-left ${
                member.deletedAt ? 'opacity-50' : ''
              }`}
            >
              <GradeBadge grade={member.grade} />
              {/* 윗줄·아랫줄을 각각 한 줄로 — 좌우 두 덩어리로 두면 좁은 화면에서 이름이 0폭으로 줄고
                  생년월일이 오른쪽 출석 수 밑으로 겹쳐 보였다. 이름은 줄이지 않고, 모자라면 배지·생년월일이 줄어든다 */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-body font-medium whitespace-nowrap">{member.name}</span>
                  <GenderMarker gender={member.gender} />
                  <span className="flex min-w-0">
                    <RoleBadge role={member.role} />
                  </span>
                  <span className="ml-auto shrink-0 text-caption text-dim">{formatLastAttended(member.lastAttendedAt)}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 text-caption">
                  <span className={`min-w-0 truncate ${member.isGuest ? 'text-sky' : 'tabular font-mono text-faint'}`}>
                    {member.isGuest ? '게스트' : (member.birthDate ?? '생년월일 없음')}
                  </span>
                  <span className="tabular ml-auto shrink-0 font-mono text-faint">
                    출석 {member.totalSessions} · {member.totalGames}게임
                  </span>
                </span>
              </span>
            </button>
          ))}
          {/* 목록 끝 표시 — 보이면 다음 100명 */}
          {hasMore && (
            <div ref={sentinelRef} className="py-4 text-center text-body-sm text-faint">
              {loadingMore ? '더 불러오는 중...' : ''}
            </div>
          )}
        </div>
      </Sheet>
      {registerOpen && (
        <MemberRegisterSheet onRegistered={refetch} onClose={() => setRegisterOpen(false)} />
      )}
      {editTarget && (
        <MemberEditSheet
          member={editTarget}
          run={run}
          busy={busy}
          onShowHistory={() => setHistoryTarget(editTarget)}
          onClose={() => setEditTarget(null)}
        />
      )}
      {historyTarget && (
        <MemberSessionHistorySheet
          memberId={historyTarget.id}
          name={historyTarget.name}
          grade={historyTarget.grade}
          onClose={() => setHistoryTarget(null)}
        />
      )}
      {cleanupOpen && (
        <StaleGuestCleanupSheet
          guests={staleGuests}
          run={run}
          busy={busy}
          onClose={() => setCleanupOpen(false)}
        />
      )}
      {toast && <Toast toast={toast} />}
    </>
  );
}

// 신규 등록 시트 — 체크인 없이 명단에만 추가한다 (모임 전 사전 등록용, 세션 불필요)
// 모임 중 지각자 등록+체크인은 [수동 체크인]의 [신규 등록]이 담당 — 여긴 원장 작업만
function MemberRegisterSheet({
  onRegistered,
  onClose,
}: {
  onRegistered: () => Promise<unknown>; // 명단 다시 불러오기
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel="신규 등록"
      layer="z-50"
      dismissible={false}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 scroll-area"
      onClose={onClose}
      header={
        <>
          <h3 className="shrink-0 text-heading font-bold whitespace-nowrap">신규 등록</h3>
          <p className="min-w-0 truncate text-caption text-faint">출석 없이 명단에만</p>
        </>
      }
    >

      {/* 명단 정리 맥락은 모임원 등록이 기본 (현장 즉석 등록과 반대) */}
      <MultiMemberForm
        defaultGuest={false}
        actionLabel="등록"
        register={async (body) => {
          await api('/members', { method: 'POST', admin: true, body });
        }}
        onFinished={(done, remaining) => {
          void onRegistered();
          if (remaining === 0) onClose();
          else if (done.length > 0) setNotice(`${done.length}명 등록 완료 — 남은 줄을 확인해주세요`);
        }}
      />
      {notice && <p className="text-body-sm font-medium text-court">{notice}</p>}
      <p className="text-caption leading-relaxed text-faint">
        개인정보 동의는 본인이 처음 입장 코드로 들어올 때 받아요. 등록은 본인에게 구두로 동의받아
        주세요.
      </p>
    </Sheet>
  );
}

// 오래 안 온 게스트 일괄 정리 — 자동 삭제는 하지 않는다(조용히 사라지면 현장에서 "왜 이름이 없지"가 된다)
// 운영진이 목록을 보고 골라서 지운다. 삭제는 soft라 실수해도 [삭제됨] 탭에서 복구 가능
function StaleGuestCleanupSheet({
  guests,
  run,
  busy,
  onClose,
}: {
  guests: IMemberSummary[];
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(guests.map((g) => g.id)), // 기본 전체 선택 — 이미 조건으로 걸러진 명단이고 2탭 확인이 남아 있다
  );
  const [confirm, setConfirm] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const removeSelected = () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    void run(async () => {
      // 서버 엔드포인트가 1명 단위라 순차 호출 — 수동 체크인 다중 선택과 같은 패턴
      for (const id of selected) {
        await api(`/members/${id}`, { method: 'DELETE', admin: true });
      }
      onClose();
    });
  };

  return (
    <Sheet
      ariaLabel="오래 안 온 게스트 정리"
      layer="z-50"
      onClose={onClose}
      header={<h3 className="shrink-0 font-bold whitespace-nowrap text-amber">오래 안 온 게스트 정리</h3>}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <button
          onClick={removeSelected}
          disabled={busy || selected.size === 0}
          className={`h-11 w-full rounded-xl border text-sm font-bold disabled:opacity-50 ${
            confirm ? 'border-coral bg-coral/15 text-coral' : 'border-amber/40 text-amber'
          }`}
        >
          {confirm ? `한 번 더 누르면 ${selected.size}명이 삭제돼요` : `${selected.size}명 삭제`}
        </button>
      }
    >
      <p className="pb-3 text-xs leading-relaxed text-dim">
        {STALE_GUEST_DAYS}일 이상 안 온 게스트예요. 출석 추가 검색을 어지럽히지 않게 정리하세요 —
        삭제해도 지난 기록은 남고, [삭제됨] 탭에서 복구할 수 있어요.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 scroll-area">
        {guests.map((guest) => {
          const picked = selected.has(guest.id);
          return (
            <button
              key={guest.id}
              onClick={() => toggle(guest.id)}
              className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm ${
                picked ? 'border-amber bg-amber/10' : 'border-line bg-panel2'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-caption font-bold ${
                  picked ? 'border-amber bg-amber text-bg' : 'border-line text-transparent'
                }`}
              >
                ✓
              </span>
              <GradeBadge grade={guest.grade} />
              <span className="truncate font-medium">{guest.name}</span>
              <GenderMarker gender={guest.gender} />
              <span className="ml-auto shrink-0 text-caption text-dim">
                {formatLastAttended(guest.lastAttendedAt)}
              </span>
            </button>
          );
        })}
      </div>

    </Sheet>
  );
}
