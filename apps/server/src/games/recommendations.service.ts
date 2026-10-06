import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  IGameRecommendation,
  IRecommendedPlayer,
  RecommendationCategory,
  RecommendationKind,
} from '@letscok/shared-types';
import { Attendance, Member } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';

// 추천 = 운영진 보조 도구. 급수 균형 최적화가 아니라 공정성(대기·게임수)+다양성(반복 회피) 점수의
// 전수 탐색 — 대기 인원이 수십 명 규모라 조합 전체를 계산해도 ms 단위로 끝난다
type Pooled = Attendance & { member: Member };

// 점수 가중치 — 초기값, 파일럿에서 체감 튜닝 예정
const W_WAIT = 1; // 대기 1분당 가점 (공정성 기본 축)
const W_GAMES = 15; // "온 시간에 비해 더 친" 게임 1회당 감점 (덜 친 사람 우선) — 단순 게임 수가 아니라 기대치 대비
const W_REPEAT = 20; // 오늘 함께 뛴 쌍 1회당 감점 (다양성)
const W_GRADE = 30; // 급수 간격이 3을 초과하는 만큼 감점 (극단 조합만 회피)
const W_BORROW = 25; // 차용 인원 1명당 감점 (미배정 대기 인원이 항상 우선)
const W_GENDER = 30; // 표준 복식(남복·여복·혼복)으로 안 떨어지는 성별 구성 감점 (금지 아닌 선호)

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];
const POOL_CAP = 30; // 전수 탐색 상한 — C(30,4)=27,405 조합
const BORROW_CAP = 12; // 잔여 모드 차용 풀 상한

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  ALL: '전체',
  MENS: '남복',
  WOMENS: '여복',
  MIXED: '혼복',
  OTHER: '기타 3:1',
};

// 종목 탭 풀 필터: 남복/여복은 해당 성별만, 혼복/기타는 성별 확정자만 (미지정은 ALL 전용)
function inCategory(a: Pooled, category: RecommendationCategory): boolean {
  if (category === 'ALL') return true;
  if (category === 'MENS') return a.member.gender === 'MALE';
  if (category === 'WOMENS') return a.member.gender === 'FEMALE';
  return a.member.gender !== null;
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {}

  // 다음 1게임에 대한 후보 조합 최대 3개 (공정성/새 조합/믹스) — 저장 없이 계산만
  // category = 종목 탭 필터. ALL이면 기존 동작, 종목이면 성별 확정자 풀 + 구성 강제
  // fixedIds = "이 사람은 꼭 넣어"(AI 명령 등) — 모든 후보에 포함하고 나머지 자리만 점수로 채운다.
  //   지정이 있으면 못 만드는 이유를 409로 알려 준다(지정 없는 기존 추천은 빈 배열 그대로)
  async recommend(
    sessionId: string,
    category: RecommendationCategory = 'ALL',
    fixedIds: string[] = [],
  ): Promise<IGameRecommendation[]> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const [allAttendances, playedGames] = await Promise.all([
      this.prisma.attendance.findMany({
        // 콕 미확인은 추천 후보에서 아예 제외 — 고른 뒤 서버가 거부하면 운영진이 헛수고한다
        where: {
          sessionId,
          status: { not: 'LEFT' },
          shuttleConfirmedAt: { not: null },
        },
        include: { member: true },
      }),
      // 오늘 "같이 뛴" 이력 = 종료된 게임 + 지금 뛰는 게임 (QUEUED 조합은 아직 안 뛰었으므로 제외)
      this.prisma.game.findMany({
        where: { sessionId, status: { in: ['FINISHED', 'PLAYING'] } },
        select: { players: { select: { attendanceId: true } } },
      }),
    ]);

    const attendances = allAttendances.filter((a) => inCategory(a, category));
    const fixed = this.resolveFixed(allAttendances, fixedIds, category);
    const fixedSet = new Set(fixed.map((a) => a.id));

    // 같은 게임을 뛴 쌍의 등장 횟수 — 반복 회피 감점의 재료
    const pairCounts = new Map<string, number>();
    for (const game of playedGames) {
      const ids = game.players.map((p) => p.attendanceId);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j]);
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }

    // 선발 풀: 미배정 대기(오래 기다린 순) / 차용 풀: 조합·게임에 묶인 인원(적게 뛴 순) — 지정 인원은 빼고
    const rest = attendances.filter((a) => !fixedSet.has(a.id));
    const free = rest
      .filter((a) => a.status === 'CHECKED_IN')
      .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime())
      .slice(0, POOL_CAP);
    const need = 4 - fixed.length;
    if (fixed.length === 0 && free.length === 0) return []; // 미배정 대기가 아예 없으면 추천할 것이 없다

    let combos: Pooled[][];
    if (need === 0) {
      combos = [fixed]; // 4명을 다 지정 — 추천 없이 그대로
    } else if (free.length >= need) {
      combos = choose(free, need).map((chosen) => [...fixed, ...chosen]);
    } else {
      // 잔여 모드: 미배정 전원 고정 + 부족분은 조합·게임 중 인원에서 차용
      const borrowPool = rest
        .filter((a) => a.status === 'MATCHED' || a.status === 'PLAYING')
        .sort(
          (a, b) =>
            a.gamesPlayed - b.gamesPlayed ||
            a.waitingSince.getTime() - b.waitingSince.getTime(),
        )
        .slice(0, BORROW_CAP);
      const lack = need - free.length;
      if (borrowPool.length < lack) {
        // 체크인 인원 자체가 4명 미만
        if (fixed.length > 0) throw new ConflictException('남은 인원으로 4명을 채울 수 없어요.');
        return [];
      }
      combos = choose(borrowPool, lack).map((borrowed) => [...fixed, ...free, ...borrowed]);
    }

    // 혼복/기타는 남녀 혼합 풀에서 나온 조합 중 구성이 맞는 것만 (남복/여복은 풀 필터로 이미 보장)
    if (category === 'MIXED' || category === 'OTHER') {
      combos = combos.filter((players) => matchesComposition(players, category));
    }
    if (combos.length === 0) {
      if (fixed.length > 0) {
        throw new ConflictException(`지정한 사람으로는 ${CATEGORY_LABEL[category]} 구성을 만들 수 없어요.`);
      }
      return [];
    }

    const now = Date.now();
    // 온 시간 대비 게임 수 — 늦게 온 사람이 총 게임 수를 따라잡으려 연속 추천되지 않게.
    // 오늘 평균 속도(전체 게임 ÷ 전체 참여 분)로 "참여한 만큼 쳤어야 할 게임 수"를 구하고, 그보다 더 친 만큼만 감점한다.
    // 참여 시작 = 콕 확인 시각(체크인 시각 아님). 휴식 시간도 참여에 들어가는 근사다
    const participation = (a: Pooled) =>
      a.shuttleConfirmedAt ? Math.max(0, (now - a.shuttleConfirmedAt.getTime()) / 60_000) : 0;
    const totalMinutes = allAttendances.reduce((sum, a) => sum + participation(a), 0);
    const totalGames = allAttendances.reduce((sum, a) => sum + a.gamesPlayed, 0);
    const gamesPerMinute = totalMinutes > 0 ? totalGames / totalMinutes : 0;
    const excessGames = (a: Pooled) => a.gamesPlayed - participation(a) * gamesPerMinute;

    const scored = combos.map((players) => {
      let waitSum = 0;
      let excessSum = 0;
      let borrowed = 0;
      const grades = players.map((p) => GRADE_ORDER.indexOf(p.member.grade));
      for (const p of players) {
        waitSum += waitingMinutes(p.waitingSince, now);
        excessSum += excessGames(p);
        if (p.status !== 'CHECKED_IN') borrowed++;
      }
      let repeatOccur = 0; // 등장 횟수 합 (감점용)
      let repeatPairs = 0; // 만난 적 있는 쌍의 수 (표시용)
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const count = pairCounts.get(pairKey(players[i].id, players[j].id)) ?? 0;
          repeatOccur += count;
          if (count > 0) repeatPairs++;
        }
      }
      const gradeExcess = Math.max(0, Math.max(...grades) - Math.min(...grades) - 3);
      // 종목 탭은 구성이 강제라 성별 선호 감점이 무의미 — ALL에서만 적용
      const genderPenalty =
        category === 'ALL' && !isCleanGenderComposition(players) ? W_GENDER : 0;
      const base =
        waitSum * W_WAIT -
        excessSum * W_GAMES -
        gradeExcess * W_GRADE -
        borrowed * W_BORROW -
        genderPenalty;
      return {
        players,
        repeatPairs,
        score: base - repeatOccur * W_REPEAT,
        freshScore: base - repeatOccur * W_REPEAT * 3, // 반복 감점 3배 = "오늘 안 만난 사람" 버전
      };
    });

    // 후보 구성: ①공정성 최고점 ②다양성 가중 최고점 ③상위 10위 내 무작위 — 서로 중복 제거
    const results: IGameRecommendation[] = [];
    const used = new Set<string>();
    const pick = (
      candidate: (typeof scored)[number] | undefined,
      kind: RecommendationKind,
    ) => {
      if (!candidate) return;
      const key = candidate.players
        .map((p) => p.id)
        .sort()
        .join('|');
      if (used.has(key)) return;
      used.add(key);
      results.push({
        kind,
        repeatPairCount: candidate.repeatPairs,
        genderLabel: genderLabel(candidate.players),
        players: candidate.players.map((p) => toRecommendedPlayer(p, now, fixedSet.has(p.id))),
      });
    };

    const byScore = [...scored].sort((a, b) => b.score - a.score);
    pick(byScore[0], RecommendationKind.FAIRNESS);

    const byFresh = [...scored].sort((a, b) => b.freshScore - a.freshScore);
    pick(
      byFresh.find(
        (c) => !used.has(c.players.map((p) => p.id).sort().join('|')),
      ),
      RecommendationKind.FRESH,
    );

    const topRest = byScore
      .slice(0, 10)
      .filter((c) => !used.has(c.players.map((p) => p.id).sort().join('|')));
    pick(
      topRest[Math.floor(Math.random() * topRest.length)],
      RecommendationKind.MIX,
    );

    return results;
  }

  // 지정 인원 검증 — 이 모임의 출석자(퇴장·콕 미확인 제외)여야 하고, 휴식 중이 아니며, 종목 성별에 맞아야 한다
  private resolveFixed(
    pool: Pooled[],
    fixedIds: string[],
    category: RecommendationCategory,
  ): Pooled[] {
    if (fixedIds.length === 0) return [];
    if (fixedIds.length > 4) throw new BadRequestException('최대 4명까지 지정할 수 있어요.');
    if (new Set(fixedIds).size !== fixedIds.length) {
      throw new BadRequestException('같은 모임원이 중복 지정되었어요.');
    }
    const fixed = fixedIds.map((id) => pool.find((a) => a.id === id));
    if (fixed.some((a) => !a)) {
      throw new ConflictException('콕 미확인·퇴장했거나 이 모임에 없는 모임원이 있어요.');
    }
    const list = fixed as Pooled[];
    const names = (rows: Pooled[]) => rows.map((a) => a.member.name).join(', ');
    const resting = list.filter((a) => a.status === 'RESTING');
    if (resting.length > 0) throw new ConflictException(`휴식 중인 모임원이 있어요: ${names(resting)}`);
    const misfit = list.filter((a) => !inCategory(a, category));
    if (misfit.length > 0) {
      throw new ConflictException(
        `${CATEGORY_LABEL[category]}에 넣을 수 없는 모임원이 있어요(성별): ${names(misfit)}`,
      );
    }
    return list;
  }
}

// 두 사람의 쌍을 순서 무관하게 하나의 키로 — (A,B)와 (B,A)를 같은 쌍으로 집계하기 위함
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function waitingMinutes(since: Date, now: number): number {
  return Math.max(0, Math.floor((now - since.getTime()) / 60_000));
}

// 종목 탭 구성 판정 — 풀이 성별 확정자뿐이라 null 걱정 없이 남성 수만 세면 된다
function matchesComposition(players: Pooled[], category: 'MIXED' | 'OTHER'): boolean {
  const m = players.filter((p) => p.member.gender === 'MALE').length;
  return category === 'MIXED' ? m === 2 : m === 1 || m === 3;
}

// 4인이 표준 복식(남복 4:0 / 여복 0:4 / 혼복 2:2)으로 떨어지는지.
// 미지정(null)은 와일드카드 — 어느 쪽으로도 채울 수 있다고 보고 판정한다
function isCleanGenderComposition(players: Pooled[]): boolean {
  let m = 0;
  let f = 0;
  for (const p of players) {
    if (p.member.gender === 'MALE') m++;
    else if (p.member.gender === 'FEMALE') f++;
    // null(미지정)은 카운트하지 않음 = 와일드카드
  }
  // 목표 남성 수 T(0=여복·2=혼복·4=남복) 중 하나라도 미지정으로 채워 달성 가능하면 clean
  return [0, 2, 4].some((t) => m <= t && f <= 4 - t);
}

// 모달 표시용 성별 구성 라벨 — 알려진 성별만으로 판정
function genderLabel(players: Pooled[]): string {
  let m = 0;
  let f = 0;
  let u = 0;
  for (const p of players) {
    if (p.member.gender === 'MALE') m++;
    else if (p.member.gender === 'FEMALE') f++;
    else u++;
  }
  if (u > 0) return '성별 미정 포함';
  if (m === 4) return '남복';
  if (f === 4) return '여복';
  if (m === 2 && f === 2) return '혼복';
  return `혼성 ${m}:${f}`; // 3:1 등 어정쩡한 구성
}

// 출석 → 추천 카드에 뿌릴 인원 정보. borrowedFrom으로 미배정 선발/차용을 구분해
// 프론트가 "게임 중"·"대기 조합" 배지를 붙인다 (CHECKED_IN이면 순수 대기 = null)
function toRecommendedPlayer(attendance: Pooled, now: number, pinned: boolean): IRecommendedPlayer {
  return {
    attendanceId: attendance.id,
    memberId: attendance.memberId,
    name: attendance.member.name,
    grade: attendance.member.grade,
    gender: attendance.member.gender,
    isGuest: attendance.member.isGuest,
    gamesPlayed: attendance.gamesPlayed,
    waitingMinutes: waitingMinutes(attendance.waitingSince, now),
    borrowedFrom:
      attendance.status === 'PLAYING'
        ? 'PLAYING'
        : attendance.status === 'MATCHED'
          ? 'QUEUED'
          : null,
    pinned,
  };
}

// n개 중 k개 조합 전부 (k ≤ 4의 작은 풀 전용)
function choose<T>(pool: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number) => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= pool.length - (k - pick.length); i++) {
      pick.push(pool[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}
