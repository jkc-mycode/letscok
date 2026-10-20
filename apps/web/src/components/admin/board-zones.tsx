'use client';

import { GAME_SIZE, IAttendance, ICourt, IGame } from '@letscok/shared-types';
import { AnimatePresence } from 'motion/react';
import type { ComponentProps } from 'react';
import { Empty, Zone } from '@/components/admin/board-ui';
import { NewGameSlot } from '@/components/admin/board-slots';
import { CourtCard } from '@/components/admin/court-card';
import { QueueCard } from '@/components/admin/queue-card';
import { RosterSort, RosterSortSelect } from '@/components/admin/roster-sort';
import { ShuttleRow, WaitingRow } from '@/components/admin/waiting-rows';
import { ConfirmButton } from '@/components/confirm-button';

// 관제판 세 구역 화면 — 게임 중(코트)·대기 조합·명단. 화면만 그리고, 동작과 즉시 반영 계산은 보드(admin/page)가 넘긴다
// 구역 배치(폰 탭·태블릿 2열·데스크톱 3열)와 끌어다 놓기 감싸개는 세 구역에 걸쳐 있어 보드에 둔다

type CourtCardProps = ComponentProps<typeof CourtCard>;
type QueueCardProps = ComponentProps<typeof QueueCard>;
type Run = (a: () => Promise<unknown>, lockKey?: string) => Promise<void>;

// ===== 게임 중 =====

export function CourtsZone({
  courts,
  playingByCourt,
  slotActions,
  dragEnabled,
  onManageCourts,
  onTurn,
  onEnd,
  onMore,
}: {
  courts: ICourt[];
  playingByCourt: Map<string, IGame>;
  slotActions: CourtCardProps['slotActions'];
  dragEnabled: boolean;
  onManageCourts: () => void;
  onTurn: CourtCardProps['onTurn'];
  onEnd: CourtCardProps['onEnd'];
  onMore: CourtCardProps['onMore'];
}) {
  return (
    <Zone
      title="게임 중"
      accent="text-court"
      count={playingByCourt.size}
      className="flex-1"
      // 코트는 이 구역에 보이니 여기서 바로 고친다 — 메뉴 깊이 있어 찾기 어렵다는 피드백(더보기·헤더 입구도 그대로 둠)
      headerExtra={
        <button onClick={onManageCourts} className="tap ml-auto h-8 rounded-lg bg-panel2 px-3 text-caption font-medium text-dim">
          코트 관리
        </button>
      }
    >
      {courts.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-faint">오늘 쓰는 코트를 먼저 등록해주세요</p>
          <button onClick={onManageCourts} className="h-11 rounded-xl bg-court px-5 text-sm font-bold text-bg">
            + 코트 추가하기
          </button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {courts.map((court) => (
          <CourtCard
            key={court.id}
            court={court}
            game={playingByCourt.get(court.id)}
            onTurn={onTurn}
            slotActions={slotActions}
            onEnd={onEnd}
            onMore={onMore}
            dragEnabled={dragEnabled}
          />
        ))}
      </AnimatePresence>
    </Zone>
  );
}

// ===== 대기 조합 =====

export function QueueZone({
  queuedGames,
  idleCourts,
  overlapIds,
  fillableCount,
  fillNotice,
  slotActions,
  dragEnabled,
  onFillCourts,
  onNewGame,
  onCancel,
  onMore,
  onPickCourt,
  onAssign,
  onMove,
  onFillSlot,
  onRecommend,
}: {
  queuedGames: IGame[];
  idleCourts: ICourt[];
  overlapIds: Set<string>;
  fillableCount: number; // 지금 빈 코트에 넣을 수 있는 조합 수 — 0이면 [빈 코트 채우기]를 숨긴다
  fillNotice: string | null; // 빈 코트 채우기에서 건너뛴 조합 안내
  slotActions: QueueCardProps['slotActions'];
  dragEnabled: boolean;
  onFillCourts: () => void;
  onNewGame: () => void; // 맨 아래 새 조합 자리
  onCancel: QueueCardProps['onCancel'];
  onMore: QueueCardProps['onMore'];
  onPickCourt: QueueCardProps['onPickCourt'];
  onAssign: QueueCardProps['onAssign'];
  onMove: QueueCardProps['onMove'];
  onFillSlot: QueueCardProps['onFillSlot'];
  onRecommend: QueueCardProps['onRecommend'];
}) {
  return (
    <Zone
      title="대기 조합"
      accent="text-amber"
      count={queuedGames.length}
      className="flex-1"
      headerExtra={
        fillableCount > 0 && (
          <button
            onClick={onFillCourts} // 연타는 보드의 fillCourts가 막는다 — 다른 동작이 진행 중이어도 누를 수 있게
            title="빈 코트에 대기 조합을 순서대로 한 번에 배정해요"
            className="ml-auto h-8 shrink-0 rounded-lg bg-amber px-3 text-caption font-bold text-bg disabled:opacity-50"
          >
            빈 코트 채우기 ({fillableCount})
          </button>
        )
      }
    >
      {fillNotice && (
        <p className="rounded-[10px] bg-amber/10 px-3 py-2 text-caption font-medium whitespace-normal text-amber">{fillNotice}</p>
      )}
      {queuedGames.length === 0 && <Empty>명단에서 사람을 골라 조합을 만들어주세요</Empty>}
      <AnimatePresence initial={false}>
        {queuedGames.map((game, index) => (
          <QueueCard
            key={game.id}
            game={game}
            order={index + 1}
            neighborUp={queuedGames[index - 1]}
            neighborDown={queuedGames[index + 1]}
            idleCourts={idleCourts}
            overlapIds={overlapIds}
            onCancel={onCancel}
            slotActions={slotActions}
            onMore={onMore}
            onPickCourt={onPickCourt}
            onAssign={onAssign}
            onMove={onMove}
            onFillSlot={onFillSlot}
            onRecommend={onRecommend}
            dragEnabled={dragEnabled}
          />
        ))}
      </AnimatePresence>
      <NewGameSlot dragEnabled={dragEnabled} onClick={onNewGame} />
    </Zone>
  );
}

// ===== 명단 =====

export function RosterZone({
  roster,
  pendingShuttle,
  leftCount,
  selected,
  rosterSort,
  placeLabels,
  partnerNames,
  dragEnabled,
  run,
  onRosterSort,
  onCheerTap,
  onManualCheckIn,
  onCommand,
  onRecommend,
  onCreateGame,
  onConfirmShuttle,
  onToggle,
  onMore,
}: {
  roster: IAttendance[]; // 비어 있는 사람 → 조합에 든 사람 → 게임 중 → 휴식 (보드가 정렬해서 넘긴다)
  pendingShuttle: IAttendance[]; // 콕 확인 대기
  leftCount: number;
  selected: Set<string>; // 조합 만들기로 고른 출석 id
  rosterSort: RosterSort;
  placeLabels: Map<string, string>; // 위치 칩 문구("조합 2, 3"·"1번 코트")
  partnerNames: Map<string, string>;
  dragEnabled: boolean;
  run: Run;
  onRosterSort: (sort: RosterSort) => void;
  onCheerTap: () => void; // 이스터에그 히든 존
  onManualCheckIn: () => void;
  onCommand: () => void; // AI 명령
  onRecommend: () => void;
  onCreateGame: () => void;
  onConfirmShuttle: (attendanceId: string) => void;
  onToggle: (attendanceId: string) => void;
  onMore: (attendance: IAttendance) => void;
}) {
  return (
    <Zone
      title="명단"
      accent="text-ink"
      count={roster.length}
      className="flex-1"
      headerExtra={
        <div className="ml-auto flex items-center gap-2">
          {/* 이스터에그 히든 존 — [수동 체크인]과 같은 크기의 보이지 않는 영역, 13연타로 발동 */}
          <span onClick={onCheerTap} aria-hidden className="h-7 w-[74px] cursor-default" />
          <RosterSortSelect value={rosterSort} onChange={onRosterSort} />
          <button onClick={onManualCheckIn} className="tap h-8 rounded-lg bg-panel2 px-3 text-caption font-medium text-dim">
            출석 추가
          </button>
        </div>
      }
      footer={
        <>
          <button
            onClick={onCommand}
            aria-label="AI 명령 — 말하듯 적어서 게임 짜기·종료·휴식·호출·출석"
            title="AI 명령"
            className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-panel2 text-court"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <path d="M12 17v4" />
            </svg>
          </button>
          <button onClick={onRecommend} className="h-13 rounded-xl bg-panel2 px-4 text-body-sm font-bold text-court">
            게임 추천
          </button>
          <button
            onClick={onCreateGame} // 누르자마자 반영되는 동작이라 다른 요청이 진행 중이어도 막지 않는다
            disabled={selected.size === 0}
            className="h-13 flex-1 rounded-xl bg-amber text-body font-bold text-bg disabled:bg-panel2 disabled:text-faint"
          >
            {selected.size > 0 && selected.size < GAME_SIZE ? '빈칸 조합' : '조합 만들기'} ({selected.size}/4)
          </button>
        </>
      }
    >
      {pendingShuttle.length > 0 && (
        <>
          <div className="flex items-center gap-2 pb-1">
            <p className="min-w-0 flex-1 text-caption font-medium text-amber">
              콕 확인 대기 {pendingShuttle.length}명 — [콕 확인]을 누르면 명단으로 내려가요
            </p>
            {/* 한꺼번에 콕을 냈을 때 — 두 번 눌러야 실행(콕을 안 낸 사람까지 확인되는 실수 방지) */}
            {pendingShuttle.length >= 2 && (
              <ConfirmButton
                label={`모두 콕 확인 (${pendingShuttle.length})`}
                confirmLabel={`${pendingShuttle.length}명 모두 확인`}
                title="콕 확인 대기 전원을 한 번에 확인"
                onConfirm={() => pendingShuttle.forEach((a) => onConfirmShuttle(a.id))}
                className="tap h-9 shrink-0 rounded-lg px-3 text-caption font-bold"
                idleCls="bg-amber text-bg"
              />
            )}
          </div>
          <AnimatePresence initial={false}>
            {pendingShuttle.map((attendance) => (
              <ShuttleRow key={attendance.id} attendance={attendance} run={run} onConfirm={onConfirmShuttle} />
            ))}
          </AnimatePresence>
          <div className="mb-1 border-b border-line" />
        </>
      )}
      {roster.length === 0 && pendingShuttle.length === 0 && <Empty>출석한 사람이 없어요</Empty>}
      {/* 조합·게임에 든 사람도 겹쳐 넣을 수 있어 선택은 된다 */}
      <AnimatePresence initial={false}>
        {roster.map((attendance) => (
          <WaitingRow
            key={attendance.id}
            onMore={onMore}
            attendance={attendance}
            selected={selected.has(attendance.id)}
            onToggle={() => onToggle(attendance.id)}
            run={run}
            busyStatus={attendance.status === 'PLAYING' || attendance.status === 'MATCHED' ? attendance.status : undefined}
            placeLabel={placeLabels.get(attendance.id)}
            resting={attendance.status === 'RESTING'}
            dragEnabled={dragEnabled}
            partnerName={partnerNames.get(attendance.id)}
          />
        ))}
      </AnimatePresence>
      {leftCount > 0 && <p className="pt-2 text-center text-xs text-faint">퇴장 {leftCount}명</p>}
    </Zone>
  );
}
