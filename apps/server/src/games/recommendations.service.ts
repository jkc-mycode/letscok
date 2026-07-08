import { Injectable } from '@nestjs/common';
import {
  IGameRecommendation,
  IRecommendedPlayer,
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
const W_GAMES = 15; // 오늘 게임 1회당 감점 (적게 뛴 사람 우선)
const W_REPEAT = 20; // 오늘 함께 뛴 쌍 1회당 감점 (다양성)
const W_GRADE = 30; // 급수 간격이 3을 초과하는 만큼 감점 (극단 조합만 회피)
const W_BORROW = 25; // 차용 인원 1명당 감점 (미배정 대기 인원이 항상 우선)
const W_GENDER = 30; // 표준 복식(남복·여복·혼복)으로 안 떨어지는 성별 구성 감점 (금지 아닌 선호)

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];
const POOL_CAP = 30; // 전수 탐색 상한 — C(30,4)=27,405 조합
const BORROW_CAP = 12; // 잔여 모드 차용 풀 상한

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {}

  // 다음 1게임에 대한 후보 조합 최대 3개 (공정성/새 조합/믹스) — 저장 없이 계산만
  async recommend(sessionId: string): Promise<IGameRecommendation[]> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);

    const [attendances, playedGames] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { sessionId, status: { not: 'LEFT' } },
        include: { member: true },
      }),
      // 오늘 "같이 뛴" 이력 = 종료된 게임 + 지금 뛰는 게임 (QUEUED 조합은 아직 안 뛰었으므로 제외)
      this.prisma.game.findMany({
        where: { sessionId, status: { in: ['FINISHED', 'PLAYING'] } },
        select: { players: { select: { attendanceId: true } } },
      }),
    ]);

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

    // 선발 풀: 미배정 대기(오래 기다린 순) / 차용 풀: 조합·게임에 묶인 인원(적게 뛴 순)
    const free = attendances
      .filter((a) => a.status === 'CHECKED_IN')
      .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime())
      .slice(0, POOL_CAP);
    if (free.length === 0) return []; // 미배정 대기가 아예 없으면 추천할 것이 없다

    let combos: Pooled[][];
    if (free.length >= 4) {
      combos = choose(free, 4);
    } else {
      // 잔여 모드: 미배정 전원 고정 + 부족분은 조합·게임 중 인원에서 차용
      const borrowPool = attendances
        .filter((a) => a.status === 'MATCHED' || a.status === 'PLAYING')
        .sort(
          (a, b) =>
            a.gamesPlayed - b.gamesPlayed ||
            a.waitingSince.getTime() - b.waitingSince.getTime(),
        )
        .slice(0, BORROW_CAP);
      const need = 4 - free.length;
      if (borrowPool.length < need) return []; // 체크인 인원 자체가 4명 미만
      combos = choose(borrowPool, need).map((borrowed) => [...free, ...borrowed]);
    }

    const now = Date.now();
    const scored = combos.map((players) => {
      let waitSum = 0;
      let gamesSum = 0;
      let borrowed = 0;
      const grades = players.map((p) => GRADE_ORDER.indexOf(p.member.grade));
      for (const p of players) {
        waitSum += waitingMinutes(p.waitingSince, now);
        gamesSum += p.gamesPlayed;
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
      const genderPenalty = isCleanGenderComposition(players) ? 0 : W_GENDER;
      const base =
        waitSum * W_WAIT -
        gamesSum * W_GAMES -
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
        players: candidate.players.map((p) => toRecommendedPlayer(p, now)),
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
}

// 두 사람의 쌍을 순서 무관하게 하나의 키로 — (A,B)와 (B,A)를 같은 쌍으로 집계하기 위함
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function waitingMinutes(since: Date, now: number): number {
  return Math.max(0, Math.floor((now - since.getTime()) / 60_000));
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
function toRecommendedPlayer(attendance: Pooled, now: number): IRecommendedPlayer {
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
