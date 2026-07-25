import { ConflictException, Injectable } from '@nestjs/common';
import { IMember } from '@letscok/shared-types';
import { toMemberResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMemberDto): Promise<IMember> {
    // 게스트는 생년월일 없이 등록 (보내와도 무시하고 null 저장 — 게스트 정책)
    const birthDate = dto.isGuest || !dto.birthDate ? null : new Date(dto.birthDate);

    // 이름+생년월일이 같으면 동일 인물로 간주 — 재체크인 등으로 인한 중복 등록 방지
    // 게스트는 이름+null 매칭이라 같은 이름 게스트 재등록도 걸린다
    const duplicate = await this.prisma.member.findFirst({
      where: {
        name: dto.name,
        birthDate,
        deletedAt: null,
      },
    });
    if (duplicate) {
      throw new ConflictException(
        '이미 등록된 모임원입니다. 이름 검색으로 본인을 선택해주세요.',
      );
    }

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
      orderBy: [{ name: 'asc' }, { birthDate: 'asc' }],
      take: 20, // 한 글자 검색 등 과다 결과 방지
    });
    return members.map(toMemberResponse);
  }
}
