'use client';

import { IHistorySessionDetail, ISessionSnapshot, matchesName } from '@letscok/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { ClearableInput } from '@/components/clearable-input';
import { GradeBadge } from '@/components/badges';
import { api, ApiError } from '@/lib/api';

// 오늘 게임 기록 — 끝난 게임 목록

// 완료(FINISHED) 게임만 — 진행 중은 코트 구역에 이미 보이므로 중복 노출 안 함
// 서버는 히스토리 상세 API 재사용 (OPEN 세션에도 동작, 별도 엔드포인트 안 만듦)
export function TodayGamesModal({
  sessionId,
  snapshot,
  onClose,
}: {
  sessionId: string;
  snapshot: ISessionSnapshot;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<IHistorySessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(
        await api<IHistorySessionDetail>(`/history/sessions/${sessionId}`, { admin: true }),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '게임 기록을 불러오지 못했습니다.');
    }
  }, [sessionId]);
  // 스냅샷 변경마다 재조회 — 모달이 열린 동안 끝난 게임도 따라온다
  // (FINISHED는 스냅샷에 안 실리므로 브로드캐스트를 refetch 트리거로만 사용, 메모 패널과 같은 패턴)
  useEffect(() => {
    void load();
  }, [load, snapshot]);

  const q = query.trim();
  // 순번은 시간순(1 = 첫 게임)으로 매긴 뒤 최신 완료가 위로 오게 역순 — 현장에선 방금 끝난 게임을 주로 찾음
  const games = useMemo(() => {
    const numbered = (detail?.games ?? []).map((game, i) => ({ ...game, no: i + 1 })).reverse();
    if (!q) return numbered;
    return numbered.filter((game) => game.players.some((player) => matchesName(player.name, q)));
  }, [detail, q]);

  const timeOf = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '--:--';

  return (
    <Sheet
      ariaLabel="오늘 게임 기록"
      onClose={onClose}
      width="sm:max-w-2xl"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">오늘 게임 기록</h2>
          {detail && (
            <p className="text-xs text-faint">완료 {detail.session.finishedGameCount}게임</p>
          )}
        </>
      }
    >
      <ClearableInput
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름으로 검색"
        className="h-11 rounded-lg border-2 border-transparent bg-panel2 px-3 text-sm outline-none focus:border-court"
        onClear={() => setQuery('')}
        wrapperClassName="mb-3"
      />
      {q && detail && (
        <p className="pb-2 text-xs text-dim">
          &lsquo;{q}&rsquo; 포함 <span className="font-bold text-court">{games.length}</span>게임
        </p>
      )}

      <div className="min-h-0 flex-1 scroll-area">
        {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
        {!error && detail === null && (
          <p className="py-10 text-center text-sm text-dim">불러오는 중...</p>
        )}
        {detail && games.length === 0 && (
          <p className="py-10 text-center text-sm text-faint">
            {q ? `'${q}' 이(가) 포함된 완료 게임이 없어요` : '아직 완료된 게임이 없어요'}
          </p>
        )}
        <ul className="space-y-1.5">
          {games.map((game) => (
            <li
              key={game.id}
              className="flex items-center gap-3 rounded-xl bg-panel2 px-4 py-2.5"
            >
              <span className="tabular w-8 shrink-0 font-mono text-xs text-faint">
                #{game.no}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                {game.players.map((player, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <GradeBadge grade={player.grade} />
                    <span
                      className={
                        q && matchesName(player.name, q) ? 'font-bold text-court' : 'font-medium'
                      }
                    >
                      {player.name}
                    </span>
                  </span>
                ))}
              </div>
              <div className="shrink-0 text-right text-xs text-dim">
                <p>{game.courtNo != null ? `${game.courtNo}번 코트` : '코트 미지정'}</p>
                <p className="tabular font-mono text-faint">
                  {timeOf(game.startedAt)} ~ {timeOf(game.endedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
