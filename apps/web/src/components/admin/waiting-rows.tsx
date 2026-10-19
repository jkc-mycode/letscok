'use client';

import { IAttendance } from '@letscok/shared-types';
import { usePersonDrag } from '@/components/board-dnd';
import { GenderMarker, GradeBadge } from '@/components/badges';
import { MotionCard } from '@/components/motion-card';
import { api } from '@/lib/api';
import { GuestMark, RoleCrown, WaitingMinutesText } from '@/components/admin/board-ui';
import { ConfirmButton } from '@/components/confirm-button';

// 대기 명단 줄 — 콕 확인 대기 줄과 명단 줄

// 콕 확인 대기 행 — [콕 확인] 버튼만 누른다 (행 전체를 버튼으로 두면 스크롤하다 스친 행이 확인돼 버린다)
// 확인 전에는 게임 배정이 막히므로 선택 체크박스는 없다
export function ShuttleRow({
  attendance,
  run,
  onConfirm,
}: {
  attendance: IAttendance;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  onConfirm: (attendanceId: string) => void; // 누르자마자 명단으로(잠금 없이 — 연달아 눌러도 모두 처리)
}) {
  const member = attendance.member;
  if (!member) return null;
  return (
    <MotionCard className="flex min-h-11 items-center gap-2 rounded-[10px] bg-amber/10 py-1.5 pr-1.5 pl-2.5 text-body-sm transition-colors">
      <GradeBadge grade={member.grade} />
      <RoleCrown role={member.role} />
      <span className="shrink-0 whitespace-nowrap font-medium">{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <GuestMark />}
      {/* 사전 체크인 취소 — 개인 사정·노쇼 등으로 못 오게 된 사람을 출석 기록 없이 제거 (퇴장과 다름) */}
      {/* 출석 취소(노쇼) 2탭 확인 — 콕 확인 바로 옆이라 오탭 한 번에 지워지면 안 된다 */}
      <ConfirmButton
        label="취소"
        title="출석 취소 — 못 오게 된 사람을 출석 기록 없이 제거"
        onConfirm={() => void run(() => api(`/attendances/${attendance.id}`, { method: 'DELETE', admin: true }))}
        className="tap ml-auto h-8 shrink-0 rounded-lg px-2.5 text-caption font-medium"
        idleCls="text-dim"
      />
      <button
        onClick={() => onConfirm(attendance.id)}
        className="h-8 shrink-0 rounded-lg bg-amber px-3 text-caption font-bold text-bg"
      >
        콕 확인
      </button>
    </MotionCard>
  );
}

export function WaitingRow({
  attendance,
  selected,
  onToggle,
  run,
  busyStatus,
  placeLabel,
  resting,
  onMore,
  dragEnabled,
  partnerName,
}: {
  attendance: IAttendance;
  selected: boolean;
  onToggle: () => void;
  run: (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;
  onMore: (attendance: IAttendance) => void; // 폰: 줄 버튼 대신 [⋯] → 동작 시트
  busyStatus?: 'PLAYING' | 'MATCHED'; // 조합·게임에 든 사람 — 흐리게 + 위치 칩, 휴식·퇴장 버튼 없음
  placeLabel?: string; // 위치 칩 문구("조합 2, 3"·"1번 코트")
  resting?: boolean; // 휴식 행 — 선택 불가, 복귀·퇴장 버튼만
  dragEnabled: boolean; // 태블릿: 살짝 길게 눌러(마우스는 끌어) 조합 칸으로 옮긴다
  partnerName?: string; // 대회 연습 파트너 — 눌러서(두 번) 해제
}) {
  const member = attendance.member;
  const drag = usePersonDrag(
    {
      kind: 'person',
      attendanceId: attendance.id,
      name: member?.name ?? '',
      grade: member?.grade ?? 'C',
      gender: member?.gender ?? null,
      fromGameId: null,
      playing: attendance.status === 'PLAYING',
    },
    dragEnabled && !resting && !!member,
  );
  if (!member) return null;
  return (
    <MotionCard
      ref={drag.ref}
      {...drag.props}
      onClick={resting ? undefined : onToggle}
      className={`flex min-h-11 items-center gap-2 rounded-[10px] py-1.5 pr-1.5 pl-2.5 text-body-sm transition-colors ${
        selected ? 'bg-amber/12 ring-[1.5px] ring-amber ring-inset' : 'bg-panel2'
      } ${(busyStatus && !selected) || resting ? 'opacity-60' : ''} ${
        resting ? '' : 'cursor-pointer'
      } ${drag.dragCls}`}
    >
      <GradeBadge grade={member.grade} />
      <RoleCrown role={member.role} />
      {/* 이름은 줄이지 않는다(폰에서 "김…"이 되던 문제) — 공간이 모자라면 옆 칩이 대신 줄어든다 */}
      <span className={`shrink-0 whitespace-nowrap ${selected ? 'font-bold' : 'font-medium'}`}>{member.name}</span>
      <GenderMarker gender={member.gender} />
      {member.isGuest && <GuestMark />}
      {busyStatus && (
        <span
          className={`min-w-0 truncate rounded-md px-1.5 py-0.5 text-caption font-medium ${
            busyStatus === 'PLAYING' ? 'bg-coral/15 text-coral' : 'bg-amber/15 text-amber'
          }`}
        >
          {placeLabel ?? (busyStatus === 'PLAYING' ? '게임 중' : '대기 조합')}
        </span>
      )}
      {resting && (
        <span className="min-w-0 truncate rounded-md bg-sky/15 px-1.5 py-0.5 text-caption font-medium text-sky">
          휴식
        </span>
      )}
      {partnerName && (
        <ConfirmButton
          label={`파트너 ${partnerName}`}
          confirmLabel="파트너 해제"
          title={`대회 연습 파트너: ${partnerName} — 두 번 누르면 해제`}
          onConfirm={() => void run(() => api(`/attendances/${attendance.id}/partner`, { method: 'DELETE', admin: true }))}
          className="tap h-6 min-w-0 shrink truncate rounded-md px-1.5 text-caption font-medium"
          idleCls="bg-sky/15 text-sky"
        />
      )}
      <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
        {/* 게임 중엔 기다리는 게 아니라 0분 — 대기 시간은 게임이 끝나면 다시 센다(대기 조합은 아직 기다리는 중이라 그대로) */}
        {attendance.gamesPlayed}게임 · {attendance.status === 'PLAYING' ? '0분' : <WaitingMinutesText since={attendance.waitingSince} alert={attendance.status === 'CHECKED_IN'} />}
      </span>
      {/* 호출·휴식/복귀·콕 확인 취소·퇴장은 [⋯] 하나로 모으고 시트에서 고른다(폰·태블릿 공통) — 작은 버튼이 줄에 붙으면 잘못 누르기 쉽다 */}
      <button
        onClick={(e) => {
          e.stopPropagation(); // 행 선택 토글과 분리
          onMore(attendance);
        }}
        aria-label={`${member.name} 동작 더보기`}
        className="tap h-8 w-8 shrink-0 rounded-lg text-lg leading-none text-dim"
      >
        ⋯
      </button>
    </MotionCard>
  );
}
