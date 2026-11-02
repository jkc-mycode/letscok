'use client';

import {
  IAttendance,
  IGame,
  IGameRecommendation,
  RecommendationCategory,
  RecommendationKind,
} from '@letscok/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/sheet';
import { PartnerNote, PersonName } from '@/components/badges';
import { api, ApiError } from '@/lib/api';

// 게임 추천 시트 — 공정성 2장·새 조합 2장, 종목 탭, 짜는 중 조합의 빈자리 추천

// 후보 성격별 표시 — 서버의 RecommendationKind와 1:1
const KIND_META: Record<
  RecommendationKind,
  { label: string; desc: string; text: string; border: string }
> = {
  FAIRNESS: { label: '공정성', desc: '오래 기다린 사람부터', text: 'text-court', border: 'border-court/40' },
  FRESH: { label: '새 조합', desc: '오늘 안 만난 사람 위주', text: 'text-sky', border: 'border-sky/40' },
};

// 종목 탭 — 서버 category 필터와 1:1. ALL이 기본(기존 동작)
const CATEGORY_TABS: { value: RecommendationCategory; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'MENS', label: '남복' },
  { value: 'WOMENS', label: '여복' },
  { value: 'MIXED', label: '혼복' },
];

// 탭별 빈 결과 사유 — 스냅샷 출석 성별을 세어 구체적으로 안내 (추가 API 없음)
function emptyMessage(category: RecommendationCategory, attendances: IAttendance[]): string {
  // 휴식·콕 미확인은 추천 풀 밖
  const active = attendances.filter((a) => a.status !== 'LEFT' && a.status !== 'RESTING' && a.shuttleConfirmedAt);
  const m = active.filter((a) => a.member?.gender === 'MALE').length;
  const f = active.filter((a) => a.member?.gender === 'FEMALE').length;
  if (category === 'ALL' && active.length < 4) return `콕 확인된 인원이 ${active.length}명이라 조합을 만들 수 없어요`;
  if (category === 'MENS' && m < 4) return `남성 인원이 ${m}명이라 남복 조합을 만들 수 없어요`;
  if (category === 'WOMENS' && f < 4) return `여성 인원이 ${f}명이라 여복 조합을 만들 수 없어요`;
  if (category === 'MIXED' && (m < 2 || f < 2))
    return `혼복은 남녀 2명씩 필요해요 (현재 남 ${m} · 여 ${f})`;
  // 인원은 충분한데 후보가 없는 경우 = 앞 조합과 시간이 겹치거나 3:1밖에 안 되는 경우
  return category === 'ALL'
    ? '지금 순서로는 겹치지 않게 남복·여복·혼복을 만들 수 없어요. 게임이 끝나면 다시 눌러 주세요'
    : '지금 순서로는 겹치지 않는 사람이 부족해요 (성별 미지정은 종목 탭에서 빠져요)';
}

export function RecommendModal({
  sessionId,
  attendances,
  placeLabels,
  fillGame,
  onAdd,
  onClose,
}: {
  sessionId: string;
  attendances: IAttendance[];
  placeLabels: Map<string, string>; // 명단과 같은 위치 표시("조합 2, 3"·"1번 코트")
  fillGame?: IGame; // 있으면 이 짜는 중 조합의 사람을 고정하고 빈자리만 추천
  onAdd: (rec: IGameRecommendation, onDone?: (ok: boolean) => void) => void; // 화면에 먼저 넣고 서버로 보낸다(보드가 맡음)
  onClose: () => void;
}) {
  const [category, setCategory] = useState<RecommendationCategory>('ALL');
  const [candidates, setCandidates] = useState<IGameRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0); // [다시 추천] 횟수 — 누를 때마다 다음 순위
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState(0); // 이 시트에서 넣은 조합 수
  const keepCards = useRef(false); // 조합을 넣은 뒤 다시 받을 때는 카드를 비우지 않는다(깜빡이지 않게)
  const fixedIds = (fillGame?.players ?? []).map((p) => p.attendanceId);
  const fixedKey = fixedIds.join(','); // 조합 사람이 바뀌면 다시 추천

  const load = useCallback(async () => {
    if (!keepCards.current) setCandidates(null);
    keepCards.current = false;
    setError(null);
    try {
      setCandidates(
        await api<IGameRecommendation[]>(
          `/sessions/${sessionId}/game-recommendations?category=${category}&page=${page}${fixedKey ? `&fixed=${fixedKey}` : ''}`,
          { admin: true },
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '추천을 불러오지 못했습니다.');
    }
  }, [sessionId, category, fixedKey, page]);
  useEffect(() => {
    void load();
  }, [load]);

  // 추천은 참고용 초안 — 넣는 길은 [조합 만들기]·[빈칸 채우기]와 같다
  // 미리 여러 개를 짜는 일이 많아 시트를 닫지 않고, 서버에 들어간 뒤 그 조합까지 반영한 1순위 추천을 다시 받는다
  const addToQueue = (rec: IGameRecommendation) => {
    if (fillGame) {
      onAdd(rec);
      onClose();
      return;
    }
    setAdding(true);
    onAdd(rec, (ok) => {
      setAdding(false);
      if (!ok) return; // 실패 안내는 보드가 띄운다 — 지금 카드를 그대로 둔다
      setAddedCount((n) => n + 1);
      keepCards.current = true;
      if (page === 0) void load();
      else setPage(0);
    });
  };

  return (
    <Sheet
      ariaLabel={fillGame ? '빈자리 추천' : '게임 추천'}
      onClose={onClose}
      width="sm:max-w-4xl"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <>
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap text-court">
            {fillGame ? '빈자리 추천' : '게임 추천'}
          </h2>
          <p className="min-w-0 text-xs text-faint">
            {addedCount > 0 ? `이번에 ${addedCount}개 넣었어요` : '참고용이에요 — 넣을지는 운영진 마음!'}
          </p>
          <button
            onClick={() => setPage((n) => n + 1)}
            className="ml-auto h-9 shrink-0 rounded-lg bg-panel2 px-3 text-sm text-dim"
          >
            다시 추천
          </button>
        </>
      }
    >
      {/* 종목 탭 — 전환 시 해당 구성으로 재요청 */}
      <div className="flex flex-wrap gap-1.5 pb-3">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setCategory(tab.value);
              setPage(0);
            }}
            className={`h-9 rounded-lg border px-3 text-sm font-medium ${
              category === tab.value
                ? 'border-court bg-court/10 text-court'
                : 'border-line text-dim'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 scroll-area">
        {error && <p className="py-10 text-center text-sm text-coral">{error}</p>}
        {!error && candidates === null && (
          <p className="py-10 text-center text-sm text-dim">추천 계산 중...</p>
        )}
        {candidates?.length === 0 && (
          <p className="py-10 text-center text-sm text-faint">
            {emptyMessage(category, attendances)}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {candidates?.map((rec) => {
            const meta = KIND_META[rec.kind];
            return (
              <div
                key={rec.players.map((p) => p.attendanceId).join('|')}
                className={`flex flex-col rounded-xl border bg-panel2 p-4 ${meta.border}`}
              >
                {/* 종류 라벨 + 성별 구성(혼복/남복/여복/혼성 N:N)을 한 줄, 설명은 아래 줄 */}
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 font-bold ${meta.text}`}>{meta.label}</span>
                  <span className="ml-auto shrink-0 rounded bg-panel px-1.5 py-0.5 text-caption font-medium text-dim">
                    {rec.genderLabel}
                  </span>
                </div>
                <span className="mt-0.5 text-caption text-faint">{meta.desc}</span>
                <div className="mt-3 flex flex-col gap-2">
                  {rec.players.map((player) => (
                    <div key={player.attendanceId} className="flex items-center gap-1.5 text-sm">
                      {/* 이름이 핵심 정보 — 뱃지·통계에 밀려도 최소 한글 4자는 보장 */}
                      <PersonName person={player} nameClassName="min-w-[4em] truncate font-medium" crown guest="short" />
                      {fixedIds.includes(player.attendanceId) && (
                        <span className="shrink-0 rounded bg-panel px-1 py-0.5 text-caption text-faint">이미 넣음</span>
                      )}
                      {player.borrowedFrom && (
                        <span
                          className={`shrink-0 rounded px-1 py-0.5 text-caption font-medium ${
                            player.borrowedFrom === 'PLAYING' ? 'bg-coral/15 text-coral' : 'bg-amber/15 text-amber'
                          }`}
                        >
                          {placeLabels.get(player.attendanceId) ?? (player.borrowedFrom === 'PLAYING' ? '게임 중' : '대기 조합')}
                        </span>
                      )}
                      {/* 이미 조합·게임에 든 사람의 대기 시간은 점수에 안 들어가 게임 수만 보여 준다 */}
                      <span className="tabular ml-auto shrink-0 font-mono text-caption text-dim">
                        {player.gamesPlayed}게임{player.borrowedFrom ? '' : ` · ${player.waitingMinutes}분`}
                      </span>
                    </div>
                  ))}
                </div>
                <PartnerNote
                  people={rec.players.map((p) => ({
                    id: p.attendanceId,
                    name: p.name,
                    partnerId: attendances.find((a) => a.id === p.attendanceId)?.partnerAttendanceId ?? null,
                  }))}
                />
                {rec.repeatPairCount > 0 && (
                  <p className="mt-2 text-caption text-faint">
                    오늘 같이 뛴 쌍 {rec.repeatPairCount}개 포함
                  </p>
                )}
                <button
                  onClick={() => addToQueue(rec)}
                  disabled={adding}
                  className="mt-3 h-11 rounded-lg bg-court text-sm font-bold text-bg disabled:bg-panel disabled:text-faint"
                >
                  {fillGame ? '빈자리에 넣기' : '대기에 추가'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
