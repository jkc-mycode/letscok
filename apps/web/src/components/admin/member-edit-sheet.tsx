'use client';

import { Gender, Grade, IMemberAlias, IMemberSummary, MemberRole } from '@letscok/shared-types';
import { useEffect, useState } from 'react';
import { GuestMark } from '@/components/badges';
import { ConfirmButton } from '@/components/confirm-button';
import { Sheet } from '@/components/sheet';
import { ClearableInput } from '@/components/clearable-input';
import { GRADES } from '@/components/multi-member-form';
import { api, ApiError } from '@/lib/api';
import { formatBirthInput, parseBirthDate } from '@/lib/birth-input';

// 모임원 정보 수정 시트 — 이름·생년월일·가입일·급수·성별·역할, 소모임 표기, 출석 이력·삭제·복구·개인정보 삭제

export const ROLE_LABEL: Record<MemberRole, string> = {
  LEADER: '모임장',
  MANAGER: '운영진',
  MEMBER: '모임원',
};

// 마지막 출석일 압축 표기 — 좁은 폰 한 줄에 들어가야 해서 연도는 다를 때만
export function formatLastAttended(date: string | null): string {
  if (!date) return '출석 없음';
  const [y, m, d] = date.split('-');
  const thisYear = String(new Date().getFullYear());
  return y === thisYear ? `${Number(m)}/${Number(d)}` : `${y.slice(2)}.${Number(m)}.${Number(d)}`;
}

// 수정 시트 — 목록 위에 겹쳐 뜬다 (폰에서 한 화면에 폼과 목록을 같이 두기엔 좁다)
export function MemberEditSheet({
  member,
  run,
  busy,
  onShowHistory,
  onClose,
}: {
  member: IMemberSummary;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  busy: boolean;
  onShowHistory: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [birth, setBirth] = useState(formatBirthInput(member.birthDate ?? ''));
  const [grade, setGrade] = useState<Grade>(member.grade);
  const [gender, setGender] = useState<Gender | null>(member.gender);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [joined, setJoined] = useState(formatBirthInput(member.joinedAt ?? ''));
  const [promote, setPromote] = useState(false); // 게스트→모임원 승격 의사
  const birthDate = parseBirthDate(birth);
  const birthDigits = birth.replace(/\D/g, '');
  const joinedAt = parseBirthDate(joined); // 생년월일과 같은 8자리 입력·범위 검사
  const joinedDigits = joined.replace(/\D/g, '');
  const deleted = member.deletedAt !== null;

  // 게스트는 승격을 켰을 때만 생년월일·역할을 다룬다 (게스트 정책: 생년월일 미수집, 역할 불가)
  const asRegular = !member.isGuest || promote;

  const save = () => {
    const dto: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== member.name) dto.name = name.trim();
    if (asRegular && birthDate && birthDate !== member.birthDate) dto.birthDate = birthDate;
    if (grade !== member.grade) dto.grade = grade;
    if (gender && gender !== member.gender) dto.gender = gender;
    if (asRegular && role !== member.role) dto.role = role;
    const nextJoined = joinedDigits.length === 0 ? null : joinedAt; // 다 지우면 null, 덜 쓴 날짜('')는 저장 버튼이 막는다
    if (asRegular && nextJoined !== member.joinedAt) dto.joinedAt = nextJoined;
    if (promote) dto.isGuest = false;
    if (Object.keys(dto).length === 0) {
      onClose();
      return;
    }
    void run(async () => {
      await api(`/members/${member.id}`, { method: 'PATCH', admin: true, body: dto });
      onClose();
    });
  };

  const blocked =
    busy ||
    !name.trim() ||
    (promote && !birthDate) ||
    (asRegular && birthDigits.length === 8 && !birthDate) ||
    (asRegular && joinedDigits.length > 0 && !joinedAt);

  return (
    // 입력 중인 시트라 바깥 배경 탭으로는 닫지 않는다(끌어내리기·[닫기]·뒤로가기는 됨)
    <Sheet
      ariaLabel={`${member.name} 수정`}
      layer="z-50"
      dismissible={false}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 scroll-area"
      onClose={onClose}
      header={
        <>
          <h3 className="min-w-0 truncate font-bold text-court">{member.name}</h3>
          {member.isGuest && <GuestMark size="full" />}
          {deleted && <span className="text-caption text-coral">삭제됨</span>}
        </>
      }
    >
      {/* 누르면 날짜별 전체 출석·게임 이력 */}
      <button
        onClick={onShowHistory}
        className="flex min-h-10 items-center gap-1 rounded-lg bg-panel2 px-3 text-left text-caption text-dim"
      >
        <span className="min-w-0 truncate">
          출석 {member.totalSessions}회 · {member.totalGames}게임 · 최근 {formatLastAttended(member.lastAttendedAt)}
        </span>
        <span className="ml-auto shrink-0 font-bold text-court">이력 ›</span>
      </button>

      {!deleted && (
        <>
          <ClearableInput
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="이름"
            className="h-11 rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
            onClear={() => setName('')}
          />

          {member.isGuest && (
            <button
              onClick={() => setPromote((v) => !v)}
              className={`min-h-10 rounded-lg border px-3 text-sm font-bold whitespace-normal ${
                promote ? 'border-court bg-court/15 text-court' : 'border-line bg-panel2 text-dim'
              }`}
            >
              {promote ? '모임원으로 바꾸기 — 생년월일을 입력해주세요' : '모임원으로 바꾸기'}
            </button>
          )}

          {asRegular && (
            <div>
              <ClearableInput
                autoComplete="off"
                type="text"
                inputMode="numeric"
                value={birth}
                onChange={(e) => setBirth(formatBirthInput(e.target.value))}
                placeholder="생년월일 8자리 (예: 19970312)"
                className="h-11 w-full rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
                onClear={() => setBirth('')}
              />
              {birthDigits.length === 8 && !birthDate && (
                <p className="mt-1 text-xs text-coral">날짜가 올바르지 않아요</p>
              )}
            </div>
          )}

          {asRegular && (
            <div>
              {/* 값이 차면 안내 문구가 사라져 위 생년월일과 구분이 안 된다 — 이름표를 따로 둔다 */}
              <span className="mb-1 block text-caption font-bold text-dim">소모임 가입일</span>
              <ClearableInput
                autoComplete="off"
                type="text"
                inputMode="numeric"
                aria-label="소모임 가입일"
                value={joined}
                onChange={(e) => setJoined(formatBirthInput(e.target.value))}
                placeholder="소모임 가입일 8자리 (예: 20240315)"
                className="h-11 w-full rounded-xl border-2 border-transparent bg-panel2 px-4 text-sm outline-none focus:border-court"
                onClear={() => setJoined('')}
              />
              {joinedDigits.length === 8 && !joinedAt && (
                <p className="mt-1 text-xs text-coral">날짜가 올바르지 않아요</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-6 gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`h-10 rounded-lg border text-sm font-bold ${
                  grade === g ? 'border-court bg-court/15 text-court' : 'border-line bg-panel2 text-dim'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setGender('MALE')}
              className={`h-10 rounded-lg border text-sm font-bold ${
                gender === 'MALE' ? 'border-sky bg-sky/15 text-sky' : 'border-line bg-panel2 text-dim'
              }`}
            >
              ♂ 남
            </button>
            <button
              onClick={() => setGender('FEMALE')}
              className={`h-10 rounded-lg border text-sm font-bold ${
                gender === 'FEMALE' ? 'border-pink bg-pink/15 text-pink' : 'border-line bg-panel2 text-dim'
              }`}
            >
              ♀ 여
            </button>
          </div>

          {/* 역할 — 표시·명단 구분용. 권한은 단일 패스코드 그대로라 접근이 달라지진 않는다 */}
          {asRegular && (
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`h-10 rounded-lg border text-sm font-bold ${
                    role === r
                      ? r === 'LEADER'
                        ? 'border-amber bg-amber/15 text-amber'
                        : 'border-court bg-court/15 text-court'
                      : 'border-line bg-panel2 text-dim'
                  }`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={save}
            disabled={blocked}
            className="h-11 rounded-xl bg-court text-sm font-bold text-bg disabled:opacity-50"
          >
            저장
          </button>
        </>
      )}

      {!deleted && <AliasEditor memberId={member.id} />}

      {/* 위험 구역 — 삭제·익명화는 2탭 확인 (단일 패스코드 구조라 권한 대신 실수 방지로 지킨다) */}
      <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3">
        {deleted ? (
          <button
            onClick={() =>
              void run(async () => {
                await api(`/members/${member.id}/restore`, { method: 'PATCH', admin: true });
                onClose();
              })
            }
            disabled={busy}
            className="min-h-11 rounded-xl bg-court/10 px-3 text-sm font-bold whitespace-normal text-court disabled:opacity-50"
          >
            복구 — 명단에 다시 표시
          </button>
        ) : (
          <ConfirmButton
            label="명단에서 삭제"
            confirmLabel="한 번 더 누르면 삭제돼요 (복구 가능)"
            onConfirm={() =>
              void run(async () => {
                await api(`/members/${member.id}`, { method: 'DELETE', admin: true });
                onClose();
              })
            }
            disabled={busy}
            className="min-h-11 rounded-xl border px-3 text-sm font-medium whitespace-normal disabled:opacity-50"
            idleCls="border-line text-dim"
            armedCls="border-coral bg-coral/15 text-coral"
          />
        )}
        <ConfirmButton
          label="개인정보 삭제 (본인 요청 시)"
          confirmLabel="한 번 더 누르면 개인정보가 지워져요 (복구 불가)"
          onConfirm={() =>
            void run(async () => {
              await api(`/members/${member.id}/anonymize`, { method: 'PATCH', admin: true });
              onClose();
            })
          }
          disabled={busy}
          className="min-h-11 rounded-xl border px-3 text-sm font-medium whitespace-normal disabled:opacity-50"
          idleCls="border-line text-dim"
          armedCls="border-coral bg-coral/15 text-coral"
        />
        <p className="text-caption leading-relaxed text-faint">
          삭제는 명단에서만 감춰요(기록 유지·복구 가능). 개인정보 삭제는 이름·생년월일·성별을
          지우고 출석·게임 기록만 남겨요 — 본인이 요청했을 때만 사용하세요.
        </p>
      </div>
    </Sheet>
  );
}

// 소모임 이름 — AI 출석에서 기억한 표기("강민"·"콕콕이"). 잘못 연결됐으면 지우고, 미리 알면 직접 추가
function AliasEditor({ memberId }: { memberId: string }) {
  const [aliases, setAliases] = useState<IMemberAlias[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<IMemberAlias[]>(`/members/${memberId}/aliases`, { admin: true })
      .then(setAliases)
      .catch(() => setAliases([]));
  }, [memberId]);

  const call = async (request: () => Promise<IMemberAlias[]>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setAliases(await request());
      setDraft('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const alias = draft.trim();
    if (!alias) return;
    void call(() => api<IMemberAlias[]>(`/members/${memberId}/aliases`, { method: 'POST', admin: true, body: { alias } }));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-bold text-dim">소모임 이름</span>
      <p className="text-caption text-faint">AI 출석이 이 이름을 보면 묻지 않고 바로 이 모임원으로 출석해요</p>
      {aliases && aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {aliases.map((a) => (
            <span key={a.id} className="flex h-9 items-center gap-1 rounded-lg bg-panel2 pr-1 pl-3 text-body-sm">
              {a.alias}
              <button
                onClick={() =>
                  void call(() => api<IMemberAlias[]>(`/members/${memberId}/aliases/${a.id}`, { method: 'DELETE', admin: true }))
                }
                disabled={busy}
                aria-label={`소모임 이름 ${a.alias} 지우기`}
                className="tap flex h-7 w-7 items-center justify-center rounded text-dim hover:text-coral"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <ClearableInput
          autoComplete="off"
          aria-label="소모임 이름 추가"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          maxLength={30}
          placeholder="예: 강민, 콕콕이"
          className="h-11 rounded-xl border-2 border-transparent bg-panel2 px-3 text-body-sm outline-none focus:border-court"
          onClear={() => setDraft('')}
          wrapperClassName="min-w-0 flex-1"
        />
        <button
          onClick={add}
          disabled={busy || !draft.trim()}
          className="tap h-11 shrink-0 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-court disabled:opacity-40"
        >
          추가
        </button>
      </div>
      {error && <p className="text-caption text-coral">{error}</p>}
    </div>
  );
}
