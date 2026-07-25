import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IMember, IMemberSummary } from '@letscok/shared-types';
import { toMemberResponse } from '../common/mappers/entity.mappers';
import { toDateString } from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMemberDto): Promise<IMember> {
    // 게스트는 생년월일 없이 등록 (보내와도 무시하고 null 저장 — 게스트 정책)
    const birthDate = dto.isGuest || !dto.birthDate ? null : new Date(dto.birthDate);

    await this.assertNoDuplicate(dto.name, birthDate);

    const member = await this.prisma.member.create({
      data: {
        name: dto.name,
        birthDate,
        grade: dto.grade,
        gender: dto.gender,
        isGuest: dto.isGuest,
        // 운영진 대리 등록이라 여기서 동의를 받을 수 없다 — 본인이 처음 체크인할 때 받아 기록한다
        consentedAt: null,
      },
    });
    return toMemberResponse(member);
  }

  async search(name: string): Promise<IMember[]> {
    // 부분 일치 검색 — 목록에 생년월일·급수를 함께 내려 동명이인을 본인이 구분하게 한다
    const members = await this.prisma.member.findMany({
      where: { name: { contains: name }, deletedAt: null },
      take: 20, // 한 글자 검색 등 과다 결과 방지
    });
    // 최근 출석순 정렬 — 자주 오는 사람이 위로, 한 번 오고 만 게스트는 아래로 (게스트 일괄 숨김 대신 택한 해법)
    const lastDates = await this.lastAttendedByMember(members.map((m) => m.id));
    return members
      .sort((a, b) => {
        const dateA = lastDates.get(a.id)?.getTime() ?? 0;
        const dateB = lastDates.get(b.id)?.getTime() ?? 0;
        if (dateA !== dateB) return dateB - dateA;
        return a.name.localeCompare(b.name, 'ko');
      })
      .map(toMemberResponse);
  }

  // 명단 목록 (운영진 전용) — 삭제된 회원 포함(복구 지원), 출석 집계 동봉
  // 규모(수십 명 × 주 1~2회)상 DB groupBy 없이 병합으로 충분 — 랭킹과 같은 접근
  async list(): Promise<IMemberSummary[]> {
    const [members, attendances] = await Promise.all([
      this.prisma.member.findMany(),
      this.prisma.attendance.findMany({
        include: { session: { select: { date: true } } },
      }),
    ]);

    const stats = new Map<
      string,
      { totalSessions: number; totalGames: number; lastDate: Date | null }
    >();
    for (const attendance of attendances) {
      const entry = stats.get(attendance.memberId) ?? {
        totalSessions: 0,
        totalGames: 0,
        lastDate: null,
      };
      entry.totalSessions += 1;
      entry.totalGames += attendance.gamesPlayed;
      if (!entry.lastDate || attendance.session.date > entry.lastDate) {
        entry.lastDate = attendance.session.date;
      }
      stats.set(attendance.memberId, entry);
    }

    return members
      .map((member) => {
        const stat = stats.get(member.id);
        return {
          ...toMemberResponse(member),
          deletedAt: member.deletedAt?.toISOString() ?? null,
          lastAttendedAt: stat?.lastDate ? toDateString(stat.lastDate) : null,
          totalSessions: stat?.totalSessions ?? 0,
          totalGames: stat?.totalGames ?? 0,
        };
      })
      .sort((a, b) => {
        // 최근 출석순 — 오래 안 온 사람이 아래로, 미출석은 맨 아래. 동률은 이름순
        const dateA = a.lastAttendedAt ?? '';
        const dateB = b.lastAttendedAt ?? '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return a.name.localeCompare(b.name, 'ko');
      });
  }

  // 정보 수정 — 이름·생년월일·급수·성별·역할 + 게스트→정회원 승격(isGuest:false + birthDate)
  async update(id: string, dto: UpdateMemberDto): Promise<IMember> {
    const member = await this.findActiveMemberOrThrow(id);

    // 승격 검증 — 게스트는 생년월일이 null이라 승격 시 반드시 함께 받는다 (동명이인 구분 복원)
    const promoting = member.isGuest && dto.isGuest === false;
    if (promoting && !dto.birthDate) {
      throw new ConflictException('정회원 승격에는 생년월일이 필요합니다.');
    }
    // 게스트인 채로 생년월일만 넣는 건 게스트 정책(미수집) 위반이라 승격과 함께만 허용
    if (!promoting && member.isGuest && dto.birthDate) {
      throw new ConflictException(
        '게스트는 생년월일을 저장하지 않습니다. 정회원 승격과 함께 입력해주세요.',
      );
    }
    // 역할은 정회원 전용 — 게스트에게 모임장·운영진을 달 수 없다
    if (dto.role && dto.role !== 'MEMBER' && member.isGuest && !promoting) {
      throw new ConflictException('게스트에게는 역할을 부여할 수 없습니다.');
    }

    // 이름·생년월일이 바뀌면 등록과 같은 중복 검사를 다시 — 기존 회원과 같은 (이름, 생년월일)이 되면 안 된다
    const nextName = dto.name ?? member.name;
    const nextBirth = dto.birthDate ? new Date(dto.birthDate) : member.birthDate;
    if (
      nextName !== member.name ||
      nextBirth?.getTime() !== member.birthDate?.getTime()
    ) {
      await this.assertNoDuplicate(nextName, nextBirth, member.id);
    }

    const updated = await this.prisma.member.update({
      where: { id: member.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.birthDate !== undefined && { birthDate: new Date(dto.birthDate) }),
        ...(dto.grade !== undefined && { grade: dto.grade }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(promoting && { isGuest: false }),
      },
    });
    return toMemberResponse(updated);
  }

  // 삭제(soft) — 진행 중 모임에 체크인된 사람은 차단: 보드에 유령이 남는다, 퇴장 처리가 먼저
  async remove(id: string): Promise<IMember> {
    const member = await this.findActiveMemberOrThrow(id);
    await this.assertNotInOpenSession(member.id);

    const removed = await this.prisma.member.update({
      where: { id: member.id },
      data: { deletedAt: new Date() },
    });
    return toMemberResponse(removed);
  }

  // 복구 — 실수 삭제 대비. 삭제 사이 같은 (이름, 생년월일)이 새로 등록됐으면 중복이라 막는다
  async restore(id: string): Promise<IMember> {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member || !member.deletedAt) {
      throw new NotFoundException('삭제된 모임원이 아닙니다.');
    }
    await this.assertNoDuplicate(member.name, member.birthDate, member.id);

    const restored = await this.prisma.member.update({
      where: { id: member.id },
      data: { deletedAt: null },
    });
    return toMemberResponse(restored);
  }

  // 익명화 삭제 — 본인의 개인정보 삭제 요청용 ("지체 없이 삭제" 약속 이행)
  // 이름·생년월일·성별을 지우고 출석·게임 행은 유지 — 통계·지난 기록이 깨지지 않는다. 복구 불가
  async anonymize(id: string): Promise<IMember> {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('등록되지 않은 모임원입니다.');
    }
    if (!member.deletedAt) {
      // 활성 회원이면 삭제와 같은 게이트 적용 (진행 중 모임 체크인 차단)
      await this.assertNotInOpenSession(member.id);
    }

    const anonymized = await this.prisma.member.update({
      where: { id: member.id },
      data: {
        name: '탈퇴한 모임원',
        birthDate: null,
        gender: null,
        role: 'MEMBER',
        consentedAt: null,
        deletedAt: member.deletedAt ?? new Date(),
      },
    });
    return toMemberResponse(anonymized);
  }

  // (이름, 생년월일) 중복 방지 — 등록·수정·복구가 같은 규칙을 공유한다
  // 게스트는 이름+null 매칭이라 같은 이름 게스트 재등록도 걸린다
  private async assertNoDuplicate(
    name: string,
    birthDate: Date | null,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.member.findFirst({
      where: {
        name,
        birthDate,
        deletedAt: null,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    if (duplicate) {
      throw new ConflictException(
        '이미 등록된 모임원입니다. 이름 검색으로 본인을 선택해주세요.',
      );
    }
  }

  private async assertNotInOpenSession(memberId: string) {
    const active = await this.prisma.attendance.findFirst({
      where: {
        memberId,
        status: { not: 'LEFT' },
        session: { status: 'OPEN' },
      },
    });
    if (active) {
      throw new ConflictException(
        '진행 중인 모임에 체크인된 모임원입니다. 퇴장 처리 후 삭제해주세요.',
      );
    }
  }

  private async findActiveMemberOrThrow(id: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('등록되지 않은 모임원입니다.');
    }
    return member;
  }

  // 회원별 마지막 출석 세션 날짜 — 검색 정렬용 (N+1 없이 한 번에)
  private async lastAttendedByMember(memberIds: string[]) {
    if (memberIds.length === 0) return new Map<string, Date>();
    const rows = await this.prisma.attendance.findMany({
      where: { memberId: { in: memberIds } },
      include: { session: { select: { date: true } } },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      const current = map.get(row.memberId);
      if (!current || row.session.date > current) {
        map.set(row.memberId, row.session.date);
      }
    }
    return map;
  }
}
