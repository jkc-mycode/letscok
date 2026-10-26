'use client';

import { GAME_SIZE, IAttendance, IGame } from '@letscok/shared-types';
import { useState } from 'react';
import { Sheet } from '@/components/sheet';
import { GradeBadge, PersonName } from '@/components/badges';
import { MegaphoneIcon } from '@/components/icons';
import { CallButton } from '@/components/admin/board-ui';
import { ConfirmButton } from '@/components/confirm-button';
import { GamesWaitText, placeChip, RosterPerson } from '@/components/admin/waiting-rows';
import { RosterSort, RosterSortSelect, sortCandidates } from '@/components/admin/roster-sort';

// 보드에서 여는 시트 — 카드·명단 [⋯], 빈칸 채우기, 선수 교체

// 부상·급한 일로 게임 중/대기 조합에서 한 명만 바꾼다 — 게임을 갈아엎지 않아 타이머·큐 순서 유지
export function ReplacePlayerModal({
  game,
  attendances,
  sort,
  onSort,
  placeLabels,
  onReplace,
  onClose,
}: {
  game: IGame;
  attendances: IAttendance[];
  placeLabels: Map<string, string>; // 명단과 같은 위치 칩("조합 2, 3"·"1번 코트")
  sort: RosterSort; // 명단과 같은 정렬
  onSort: (sort: RosterSort) => void;
  onReplace: (outAttendanceId: string, inAttendanceId: string) => void; // 누르자마자 반영(보드가 맡음)
  onClose: () => void;
}) {
  const [outId, setOutId] = useState<string | null>(null);
  const [inId, setInId] = useState<string | null>(null);

  const isPlaying = game.status === 'PLAYING';
  const playerIds = new Set((game.players ?? []).map((p) => p.attendanceId));
  // 후보: 퇴장·휴식·이 게임 인원 제외. 게임 중 게임엔 다른 코트에서 뛰는 사람 투입 불가(PLAYING 동시 한 곳만)
  const candidates = sortCandidates(attendances, sort).filter(
    (a) =>
      a.status !== 'LEFT' &&
      a.status !== 'RESTING' &&
      !playerIds.has(a.id) &&
      !(isPlaying && a.status === 'PLAYING'),
  );

  const submit = () => {
    if (!outId || !inId) return;
    onReplace(outId, inId);
    onClose();
  };

  return (
    <Sheet
      ariaLabel="선수 교체"
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">선수 교체</h2>
          <p className="min-w-0 text-xs text-faint">
            {isPlaying ? '타이머는 그대로 이어져요' : '조합 순서는 그대로 유지돼요'}
          </p>
        </>
      }
    >
      <div className="min-h-0 flex-1 scroll-area">
        <h3 className="pb-1.5 text-sm font-bold text-coral">빠질 사람</h3>
        <div className="grid grid-cols-2 gap-2">
          {(game.players ?? []).map((player) => {
            const member = player.attendance?.member;
            if (!member) return null;
            return (
              <button
                key={player.attendanceId}
                onClick={() => setOutId(player.attendanceId)}
                className={`flex items-center gap-1.5 rounded-xl border p-3 text-sm ${
                  outId === player.attendanceId
                    ? 'border-coral bg-coral/10'
                    : 'border-line bg-panel2'
                }`}
              >
                <PersonName person={member} nameClassName="truncate font-medium" crown />
              </button>
            );
          })}
        </div>

        <div className="flex items-center pt-4 pb-1.5">
          <h3 className="text-sm font-bold text-court">들어올 사람</h3>
          <span className="ml-auto">
            <RosterSortSelect value={sort} onChange={onSort} />
          </span>
        </div>
        {candidates.length === 0 && (
          <p className="py-6 text-center text-sm text-faint">교체 투입할 수 있는 인원이 없어요</p>
        )}
        <div className="flex flex-col gap-2">
          {candidates.map((attendance) => {
            const member = attendance.member;
            if (!member) return null;
            return (
              <button
                key={attendance.id}
                onClick={() => setInId(attendance.id)}
                className={`flex items-center gap-1.5 rounded-xl border p-3 text-sm ${
                  inId === attendance.id ? 'border-court bg-court/10' : 'border-line bg-panel2'
                }`}
              >
                <RosterPerson member={member} chip={placeChip(attendance, placeLabels.get(attendance.id))} />
                <GamesWaitText attendance={attendance} />
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!outId || !inId}
        className="mt-4 h-12 rounded-xl bg-court text-base font-bold text-bg disabled:bg-panel2 disabled:text-faint"
      >
        교체하기
      </button>
    </Sheet>
  );
}

// 빈칸 채우기 시트 — 명단에서 한 명씩 눌러 넣는다. game=null이면 첫 사람으로 새 조합을 만들고 그 조합을 이어서 채운다
// 4명이 차면 부모가 저절로 닫는다(실시간 스냅샷 기준)
export function SlotFillSheet({
  game,
  roster,
  placeLabels,
  sort,
  onSort,
  onPick,
  onClose,
}: {
  game: IGame | null;
  roster: IAttendance[]; // 이미 고른 정렬로 정렬된 명단
  placeLabels: Map<string, string>;
  sort: RosterSort;
  onSort: (sort: RosterSort) => void;
  onPick: (attendanceId: string) => void; // 누르자마자 그 조합에 들어간 모습으로(보드가 서버에 보낸다)
  onClose: () => void;
}) {
  const inGame = new Set((game?.players ?? []).map((p) => p.attendanceId));
  const candidates = roster.filter((a) => a.status !== 'RESTING' && !inGame.has(a.id));
  const empty = GAME_SIZE - inGame.size;

  return (
    <Sheet
      ariaLabel="조합에 넣기"
      onClose={onClose}
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-amber">조합에 넣기</h2>
          <p className="min-w-0 text-xs text-faint">빈칸 {empty}개 · 누르면 바로 들어가요</p>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-dim">
          {game && <>지금: {(game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean).join(', ')}</>}
        </p>
        <RosterSortSelect value={sort} onChange={onSort} />
      </div>
      {candidates.length === 0 && <p className="py-6 text-center text-sm text-faint">넣을 수 있는 사람이 없어요</p>}
      {candidates.map((attendance) => {
        const member = attendance.member;
        if (!member) return null;
        return (
          <button
            key={attendance.id}
            onClick={() => onPick(attendance.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-panel2 p-3 text-left text-sm disabled:opacity-50"
          >
            <RosterPerson member={member} chip={placeChip(attendance, placeLabels.get(attendance.id))} />
            <GamesWaitText attendance={attendance} />
          </button>
        );
      })}
    </Sheet>
  );
}

// 코트·조합 카드 [⋯] 시트 — 게임 중: 다시 알림·교체·게임 취소 / 대기 조합: 교체·해체
export function GameActionSheet({
  game,
  title,
  onCancel,
  onReplace,
  onMoveCourt,
  onClose,
}: {
  game: IGame;
  title: string;
  onCancel: (gameId: string) => void; // 게임 취소·해체 — 누르자마자 반영(보드가 맡음)
  onReplace: (game: IGame) => void;
  onMoveCourt: (game: IGame) => void;
  onClose: () => void;
}) {
  const playing = game.status === 'PLAYING';
  const names = (game.players ?? []).map((p) => p.attendance?.member?.name).filter(Boolean).join(', ');
  const cancel = () => {
    onCancel(game.id);
    onClose();
  };
  const row = 'h-12 w-full rounded-xl px-4 text-left text-body-sm font-medium';
  return (
    <Sheet
      ariaLabel={`${title} 동작`}
      onClose={onClose}
      header={
        <div className="flex min-w-0 flex-col">
          <h2 className={`text-heading font-bold ${playing ? 'text-court' : 'text-amber'}`}>{title}</h2>
          <p className="truncate text-caption text-dim">{names}</p>
        </div>
      }
      bodyClassName="flex flex-col gap-2 pb-1"
    >
      {playing && (
        <CallButton
          path={`/games/${game.id}/renotify`}
          label="다시 알림 — 4명에게 코트 알림 다시 보내기"
          title="배정됐는데 안 오는 사람이 있을 때"
          className={`${row} bg-panel2`}
          idleCls="text-ink"
        />
      )}
      <button
        onClick={() => {
          onReplace(game);
          onClose();
        }}
        className={`${row} bg-panel2 text-ink`}
      >
        {playing ? '교체 — 한 명만 바꾸기(타이머 유지)' : '교체 — 한 명만 바꾸기(순서 유지)'}
      </button>
      {playing && (
        <button
          onClick={() => {
            onMoveCourt(game);
            onClose();
          }}
          className={`${row} bg-panel2 text-ink`}
        >
          다른 코트로 옮기기 — 게임 중이면 맞바꾸기(타이머 유지)
        </button>
      )}
      <ConfirmButton
        label={playing ? '게임 취소 — 조합까지 해체(게임 수 안 셈)' : '해체 — 조합을 없애고 대기로'}
        confirmLabel={playing ? '한 번 더 누르면 게임 취소' : '한 번 더 누르면 해체'}
        onConfirm={cancel}
        className={row}
        idleCls="bg-coral/10 text-coral"
      />
    </Sheet>
  );
}

// 폰 대기 줄 [⋯] 시트 — 호출·휴식/복귀·콕 확인 취소·퇴장을 큰 버튼으로. 상태에 맞는 것만 보인다
export type AttendanceChange = 'rest' | 'resume' | 'leave' | 'shuttle/cancel';

export function WaitingActionSheet({
  attendance,
  onChange,
  onClose,
}: {
  attendance: IAttendance;
  onChange: (change: AttendanceChange) => void; // 화면에 먼저 반영하고 서버로 보낸다(보드가 맡음)
  onClose: () => void;
}) {
  const member = attendance.member;
  const resting = attendance.status === 'RESTING';
  const busy = attendance.status === 'PLAYING' || attendance.status === 'MATCHED'; // 게임 중·조합에 든 사람은 호출만
  const act = (change: AttendanceChange) => {
    onChange(change);
    onClose();
  };
  const row = 'h-12 w-full rounded-xl px-4 text-left text-sm font-medium';
  return (
    <Sheet
      ariaLabel={`${member?.name ?? ''} 동작`}
      onClose={onClose}
      header={
        <>
          {member && <GradeBadge grade={member.grade} />}
          <h2 className="min-w-0 truncate text-lg font-bold">{member?.name}</h2>
          <span className="shrink-0 font-mono text-xs text-dim">{attendance.gamesPlayed}게임</span>
        </>
      }
      bodyClassName="flex flex-col gap-2 pb-1"
    >
      <CallButton
        path={`/attendances/${attendance.id}/call`}
        label={
          <span className="flex items-center gap-2">
            <MegaphoneIcon /> 호출 — 폰으로 &lsquo;운영진이 찾고 있어요&rsquo; 알림
          </span>
        }
        title="이 분 폰으로 알림을 보내요"
        className={`${row} bg-panel2`}
        idleCls="text-ink"
      />
      {resting && (
        <button onClick={() => act('resume')} className={`${row} bg-sky/10 text-sky`}>
          복귀 — 대기로 돌아가기(대기 시간 이어서)
        </button>
      )}
      {!busy && !resting && (
        <button onClick={() => act('rest')} className={`${row} bg-panel2 text-ink`}>
          휴식 — 게임 조합에서 잠깐 빼기
        </button>
      )}
      {!busy && (
        <ConfirmButton
          label="콕 확인 취소 — 콕 확인 대기로 되돌리기"
          confirmLabel="한 번 더 누르면 콕 확인 취소"
          onConfirm={() => act('shuttle/cancel')}
          className={row}
          idleCls="bg-panel2 text-amber"
        />
      )}
      {!busy && (
        <ConfirmButton
          label="퇴장"
          confirmLabel="한 번 더 누르면 퇴장"
          onConfirm={() => act('leave')}
          className={row}
          idleCls="bg-coral/10 text-coral"
        />
      )}
    </Sheet>
  );
}
