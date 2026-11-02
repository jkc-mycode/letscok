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
const W_GAMES = 15; // "온 시간에 비해 더 칠" 게임 1회당 감점 (덜 칠 사람 우선) — 대기 조합에 잡힌 게임까지 센다
const W_REPEAT = 20; // 오늘 함께 뛴 쌍 1회당 감점 (다양성)
const W_GRADE = 30; // 급수 간격이 3을 초과하는 만큼 감점 (극단 조합만 회피)
const W_BORROW = 25; // 조합·게임에 이미 든 사람 1명당 감점 (같은 조건이면 미배정 대기 인원 우선)
const W_PARTNER = 40; // 대회 연습 파트너 두 사람이 같은 게임에 든 쌍당 가점 — 대기 40분어치. 한 명만 든 조합은 가점·감점 없음(강제 아님)

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];
const POOL_CAP = 30; // 전수 탐색 상한 — C(30,4)=27,405 조합
// 줄(게임 중 → 대기 조합)에서 새 조합과 이만큼 가까운 게임의 사람은 넣지 않는다 — 같은 시간에 두 코트에 있게 된다.
// 코트 수만큼 동시에 돌아가므로 코트 2개면 조합 1번 사람을 3번에 넣을 수 있다.
// 코트가 1개여도 2칸은 띄운다 — 바로 붙은 조합끼리 겹치면 앞 조합이 코트에 들어가는 순간 뒤 조합이 막혀 순서가 꼬인다
const MIN_QUEUE_GAP = 2;

// 한 번에 보여 주는 카드 순서
const CARD_ORDER = [
  RecommendationKind.FAIRNESS,
  RecommendationKind.FAIRNESS,
  RecommendationKind.FRESH,
  RecommendationKind.FRESH,
];

const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  ALL: '전체',
  MENS: '남복',
  WOMENS: '여복',
  MIXED: '혼복',
};

// 종목 탭 풀 필터: 남복/여복은 해당 성별만, 혼복은 성별 확정자만 (미지정은 ALL 전용)
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

  // 줄 맨 끝에 넣을 1게임의 후보 조합 — 공정성 2장, 새 조합 2장. 저장 없이 계산만
  // page = [다시 추천] 횟수. 누를 때마다 다음 순위를 보여 주고, 후보가 끝나면 처음으로 돌아간다
  // 미리 짜는 운영이 기본이라 미배정 대기뿐 아니라 조합·게임에 든 사람도 후보다(휴식·콕 미확인 제외)
  // category = 종목 탭 필터. ALL은 표준 복식(남복·여복·혼복)만, 종목이면 성별 확정자 풀 + 구성 강제
  // fixedIds = "이 사람은 꼭 넣어"(AI 명령 등) — 모든 후보에 포함하고 나머지 자리만 점수로 채운다.
  //   지정이 있으면 못 만드는 이유를 409로 알려 준다(지정 없는 기존 추천은 빈 배열 그대로)
  async recommend(
    sessionId: string,
    category: RecommendationCategory = 'ALL',
    fixedIds: string[] = [],
    page = 0,
  ): Promise<IGameRecommendation[]> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const [allAttendances, playedGames, queuedGames, courts] = await Promise.all([
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
        select: { status: true, startedAt: true, players: { select: { attendanceId: true } } },
      }),
      // 대기 조합 순서 — 사람이 새 조합과 시간이 겹치는지 본다
      this.prisma.game.findMany({
        where: { sessionId, status: 'QUEUED' },
        orderBy: [{ queueOrder: 'asc' }, { queuedAt: 'asc' }],
        select: { players: { select: { attendanceId: true } } },
      }),
      this.prisma.court.findMany({
        where: { sessionId, deletedAt: null },
        select: { isShared: true, ourTurn: true },
      }),
    ]);
    // 앞으로의 줄 — 게임 중(먼저 시작한 순) 뒤에 대기 조합. 새 조합은 맨 끝, 빈자리 채우기면 그 조합 자리
    const lineup = [
      ...playedGames
        .filter((g) => g.status === 'PLAYING')
        .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0)),
      ...queuedGames,
    ].map((g) => g.players.map((p) => p.attendanceId));
    const fillIndex = fixedIds.length > 0 ? lineup.findIndex((ids) => ids.length < 4 && fixedIds.every((id) => ids.includes(id))) : -1;
    const targetIndex = fillIndex >= 0 ? fillIndex : lineup.length;
    // 지금 우리가 쓸 수 있는 코트 수 — 다른 모임 차례인 공유 코트는 뺀다
    const span = Math.max(courts.filter((c) => !c.isShared || c.ourTurn).length, MIN_QUEUE_GAP);
    const overlapping = new Set<string>();
    const committed = new Map<string, number>(); // 사람마다 지금 뛰거나 잡혀 있는 게임 수
    lineup.forEach((ids, index) => {
      for (const id of ids) {
        committed.set(id, (committed.get(id) ?? 0) + 1);
        if (index !== targetIndex && Math.abs(targetIndex - index) < span) overlapping.add(id);
      }
    });
    const projectedGames = (a: Pooled) => a.gamesPlayed + (committed.get(a.id) ?? 0);

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

    // 선발 풀: 시간이 겹치지 않는 사람 — 미배정 대기(오래 기다린 순) 다음 조합·게임에 든 사람(덜 칠 순). 지정 인원은 빼고
    const rest = attendances.filter((a) => !fixedSet.has(a.id));
    const pool = rest
      .filter((a) => ['CHECKED_IN', 'MATCHED', 'PLAYING'].includes(a.status) && !overlapping.has(a.id))
      .sort(
        (a, b) =>
          Number(a.status !== 'CHECKED_IN') - Number(b.status !== 'CHECKED_IN') ||
          (a.status === 'CHECKED_IN' ? a.waitingSince.getTime() - b.waitingSince.getTime() : projectedGames(a) - projectedGames(b)),
      )
      .slice(0, POOL_CAP);
    const need = 4 - fixed.length;
    if (pool.length < need) {
      if (fixed.length > 0) throw new ConflictException('남은 인원으로 4명을 채울 수 없어요.');
      return [];
    }
    let combos = need === 0 ? [fixed] : choose(pool, need).map((chosen) => [...fixed, ...chosen]);

    // 전체 탭도 3:1은 추천하지 않는다 — 운영진이 3:1로 지정한 사람은 그대로 둔다
    if (category === 'ALL' && isCleanGenderComposition(fixed)) {
      combos = combos.filter(isCleanGenderComposition);
    }
    // 혼복은 남녀 혼합 풀에서 나온 조합 중 2:2만 (남복/여복은 풀 필터로 이미 보장)
    if (category === 'MIXED') {
      combos = combos.filter(isMixedDoubles);
    }
    if (combos.length === 0) {
      if (fixed.length > 0) {
        throw new ConflictException(`지정한 사람으로는 ${CATEGORY_LABEL[category]} 구성을 만들 수 없어요.`);
      }
      return [];
    }

    const now = Date.now();
    // 온 시간 대비 게임 수 — 늦게 온 사람이 총 게임 수를 따라잡으려 연속 추천되지 않게.
    // 오늘 평균 속도(전체 게임 ÷ 전체 참여 분)로 "참여한 만큼 쳤어야 할 게임 수"를 구하고, 그보다 더 칠 만큼만 감점한다.
    // 대기 조합에 잡힌 게임까지 세야 미리 짤 때 같은 사람이 반복되지 않는다.
    // 참여 시작 = 콕 확인 시각(체크인 시각 아님). 휴식 시간도 참여에 들어가는 근사다
    const participation = (a: Pooled) =>
      a.shuttleConfirmedAt ? Math.max(0, (now - a.shuttleConfirmedAt.getTime()) / 60_000) : 0;
    const totalMinutes = allAttendances.reduce((sum, a) => sum + participation(a), 0);
    const totalGames = allAttendances.reduce((sum, a) => sum + projectedGames(a), 0);
    const gamesPerMinute = totalMinutes > 0 ? totalGames / totalMinutes : 0;
    const excessGames = (a: Pooled) => projectedGames(a) - participation(a) * gamesPerMinute;

    const scored = combos.map((players) => {
      let waitSum = 0;
      let excessSum = 0;
      let borrowed = 0;
      const grades = players.map((p) => GRADE_ORDER.indexOf(p.member.grade));
      for (const p of players) {
        // 대기 시간은 지금 기다리는 사람만 — 조합에 든 사람은 이미 차례를 받았다
        if (p.status === 'CHECKED_IN') waitSum += waitingMinutes(p.waitingSince, now);
        else borrowed++;
        excessSum += excessGames(p);
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
      // 파트너가 서로를 가리키는 쌍만(한쪽만 남은 옛 값은 무시)
      let partnerPairs = 0;
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          if (players[i].partnerAttendanceId === players[j].id && players[j].partnerAttendanceId === players[i].id) {
            partnerPairs++;
          }
        }
      }
      const gradeExcess = Math.max(0, Math.max(...grades) - Math.min(...grades) - 3);
      const base =
        partnerPairs * W_PARTNER +
        waitSum * W_WAIT -
        excessSum * W_GAMES -
        gradeExcess * W_GRADE -
        borrowed * W_BORROW;
      return {
        players,
        key: players.map((p) => p.id).sort().join('|'),
        repeatPairs,
        score: base - repeatOccur * W_REPEAT,
        freshScore: base - repeatOccur * W_REPEAT * 3, // 반복 감점 3배 = "오늘 안 만난 사람" 버전
      };
    });

    // 후보 묶음 — 순위대로 공정성 2장·새 조합 2장씩 나누고 이미 쓴 조합은 다시 쓰지 않는다
    // 상위 조합은 한두 명만 다른 경우가 많아, 같은 묶음 안에서는 절반 넘게 겹치지 않는 조합을 먼저 고른다
    const byScore = [...scored].sort((a, b) => b.score - a.score);
    const byFresh = [...scored].sort((a, b) => b.freshScore - a.freshScore);
    const used = new Set<string>();
    const maxShared = Math.floor(need / 2);
    const takeNext = (ranked: typeof scored, batch: typeof scored) => {
      const open = ranked.filter((c) => !used.has(c.key));
      const shared = (c: (typeof scored)[number], other: (typeof scored)[number]) =>
        c.players.filter((p) => !fixedSet.has(p.id) && other.players.includes(p)).length;
      const candidate = open.find((c) => batch.every((other) => shared(c, other) <= maxShared)) ?? open[0];
      if (candidate) {
        used.add(candidate.key);
        batch.push(candidate);
      }
      return candidate;
    };

    const batches: IGameRecommendation[][] = [];
    while (batches.length <= page) {
      const batch: typeof scored = [];
      const cards: IGameRecommendation[] = [];
      for (const [ranked, kind] of CARD_ORDER.map((k) => [k === RecommendationKind.FAIRNESS ? byScore : byFresh, k] as const)) {
        const candidate = takeNext(ranked, batch);
        if (!candidate) continue;
        cards.push({
          kind,
          repeatPairCount: candidate.repeatPairs,
          genderLabel: genderLabel(candidate.players),
          players: candidate.players.map((p) => toRecommendedPlayer(p, now, fixedSet.has(p.id))),
        });
      }
      if (cards.length === 0) break; // 후보를 다 썼다
      batches.push(cards);
    }
    return batches[page % batches.length];
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

// 혼복 탭 구성 판정 — 풀이 성별 확정자뿐이라 null 걱정 없이 남성 수만 세면 된다
function isMixedDoubles(players: Pooled[]): boolean {
  return players.filter((p) => p.member.gender === 'MALE').length === 2;
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
  return `혼성 ${m}:${f}`; // 운영진이 직접 지정한 3:1만 여기까지 온다
}

// 출석 → 추천 카드에 뿌릴 인원 정보. borrowedFrom으로 미배정 대기/이미 잡힌 사람을 구분해
// 프론트가 "게임 중"·"대기 조합" 배지를 붙인다 (CHECKED_IN이면 순수 대기 = null)
function toRecommendedPlayer(attendance: Pooled, now: number, pinned: boolean): IRecommendedPlayer {
  return {
    attendanceId: attendance.id,
    memberId: attendance.memberId,
    name: attendance.member.name,
    grade: attendance.member.grade,
    gender: attendance.member.gender,
    role: attendance.member.role,
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
