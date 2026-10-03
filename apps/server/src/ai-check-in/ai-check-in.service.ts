import { ConflictException, Injectable } from '@nestjs/common';
import {
  IAiCheckInMember,
  IAiCheckInResult,
  IAiCheckInStatus,
} from '@letscok/shared-types';
import { z } from 'zod';
import { AttendancesService } from '../attendances/attendances.service';
import { toMemberResponse } from '../common/mappers/entity.mappers';
import type { Member } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { AiClient } from './ai.client';

// AI가 캡처·명령에서 읽어 낸 이름 1건 — 표기 종류(kind)로 자동 체크인 여부가 갈린다
export const extractedNameSchema = z.strictObject({
  raw: z.string().describe('캡처·명령에 적힌 그대로의 표기'),
  name: z.string().describe('지역명·이모지·괄호 숫자 같은 장식을 뗀 이름 부분'),
  kind: z
    .enum(['full', 'given', 'nickname', 'unclear'])
    .describe('full=성+이름, given=성 없이 이름만, nickname=별명, unclear=판단 불가. 확신이 없으면 unclear'),
  birthYear: z.number().int().nullable().describe('"(97)" "97년생" 같은 생년 표기. 없으면 null'),
  guest: z.boolean().describe('"게스트" "G" 같은 게스트 표기가 있으면 true'),
});
export type ExtractedName = z.infer<typeof extractedNameSchema>;

// 비교용 이름 정규화 — 공백·이모지를 지우고 한글 조합형 차이를 맞춘다
export function normalizeName(name: string): string {
  return name.normalize('NFC').replace(/[\s\p{Extended_Pictographic}️‍]/gu, '');
}

// "97" 같은 두 자리 생년 → 1997 (30 이상은 1900년대, 미만은 2000년대)
function toFullYear(year: number): number {
  if (year >= 100) return year;
  return year >= 30 ? 1900 + year : 2000 + year;
}

@Injectable()
export class AiCheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly attendancesService: AttendancesService,
    private readonly ai: AiClient,
  ) {}

  status(): IAiCheckInStatus {
    return { enabled: this.ai.isEnabled() };
  }

  // 읽어 낸 이름들을 회원과 맞춰 확실한 사람만 체크인한다 — 판단은 AI가 아니라 이 결정적 규칙이 한다
  // 성+이름이 정확히 1명과 맞을 때만 자동, 동명이인·이름만 표기는 후보, 별명·불명은 못 찾음
  async applyNames(sessionId: string, names: ExtractedName[]): Promise<IAiCheckInResult> {
    await this.sessionsService.findOpenSessionOrThrow(sessionId);
    const members = await this.prisma.member.findMany({ where: { deletedAt: null } });
    const byNormalizedName = members.map((member) => ({ member, key: normalizeName(member.name) }));

    const checkedIn: IAiCheckInMember[] = [];
    const alreadyIn: IAiCheckInMember[] = [];
    const notFound: string[] = [];
    const ambiguous: IAiCheckInResult['ambiguous'] = [];
    const seen = new Set<string>(); // 여러 장에 같은 사람이 찍혀도 한 번만
    const handledMemberIds = new Set<string>();

    for (const item of names) {
      const name = normalizeName(item.name);
      const label = item.raw.trim() || item.name;
      const dedupeKey = `${item.kind}:${name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!name || item.kind === 'nickname' || item.kind === 'unclear') {
        notFound.push(label);
        continue;
      }

      // 이름만 — 성을 모르니 자동 체크인하지 않고, 성을 뺀 이름이 같은 회원을 후보로 보여준다
      // (성 1~2글자: 김강민 / 남궁강민)
      if (item.kind === 'given') {
        const candidates = byNormalizedName
          .filter(({ key }) => key !== name && key.endsWith(name) && key.length - name.length <= 2)
          .map(({ member }) => member);
        if (candidates.length === 0) notFound.push(label);
        else ambiguous.push({ name: label, candidates: candidates.map(toMemberResponse) });
        continue;
      }

      // 성+이름 — 완전 일치 후보를 생년·게스트 표기로 좁힌다
      const exact = byNormalizedName.filter(({ key }) => key === name).map(({ member }) => member);
      const narrowed = this.applyHints(exact, item);
      if (exact.length === 0) {
        notFound.push(label);
      } else if (narrowed.length === 1) {
        const member = narrowed[0];
        if (handledMemberIds.has(member.id)) continue;
        handledMemberIds.add(member.id);
        await this.checkIn(sessionId, member, checkedIn, alreadyIn);
      } else {
        // 여러 명이 남았거나, 표기(생년·게스트)가 회원 정보와 어긋나 0명이 됐다 — 확실하지 않으니 후보로
        const candidates = narrowed.length > 0 ? narrowed : exact;
        ambiguous.push({ name: label, candidates: candidates.map(toMemberResponse) });
      }
    }

    const result = { checkedIn, alreadyIn, notFound, ambiguous };
    return { ...result, message: this.buildMessage(result) };
  }

  // 생년 표기가 있으면 생년이 다른 회원을 뺀다(생년이 없는 게스트는 남긴다), 게스트 표기가 있으면 게스트만
  private applyHints(candidates: Member[], item: ExtractedName): Member[] {
    let out = candidates;
    if (item.birthYear !== null) {
      const year = toFullYear(item.birthYear);
      out = out.filter((m) => !m.birthDate || m.birthDate.getUTCFullYear() === year);
    }
    if (item.guest) out = out.filter((m) => m.isGuest);
    return out;
  }

  // 기존 수동 체크인을 그대로 재사용 — 409(이미 출석)는 실패가 아니라 정보로 분류
  private async checkIn(
    sessionId: string,
    member: Member,
    checkedIn: IAiCheckInMember[],
    alreadyIn: IAiCheckInMember[],
  ) {
    try {
      await this.attendancesService.manualCheckIn(sessionId, member.id);
      checkedIn.push({ memberId: member.id, name: member.name });
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      alreadyIn.push({ memberId: member.id, name: member.name });
    }
  }

  // 안내 문장은 서버가 정해진 틀로 만든다 — AI가 문장을 쓰지 않으므로 체크인 외 응답이 나올 수 없다
  private buildMessage(result: Omit<IAiCheckInResult, 'message'>): string {
    const parts: string[] = [];
    if (result.checkedIn.length > 0) parts.push(`${result.checkedIn.length}명 체크인했어요.`);
    if (result.alreadyIn.length > 0) parts.push(`${result.alreadyIn.length}명은 이미 출석 중이에요.`);
    if (result.notFound.length > 0) parts.push(`${result.notFound.join(', ')}은(는) 못 찾았어요.`);
    if (result.ambiguous.length > 0) {
      parts.push(`${result.ambiguous.map((a) => a.name).join(', ')}은(는) 누구인지 확실하지 않아요.`);
    }
    if (result.notFound.length > 0 || result.ambiguous.length > 0) parts.push('직접 체크인해주세요.');
    return parts.length > 0 ? parts.join(' ') : '체크인할 이름을 찾지 못했어요.';
  }
}
