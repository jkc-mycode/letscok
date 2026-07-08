import { ConflictException, Injectable } from '@nestjs/common';
import { IMember } from '@letscok/shared-types';
import { toMemberResponse } from '../common/mappers/entity.mappers';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMemberDto): Promise<IMember> {
    // 이름+생년월일이 같으면 동일 인물로 간주 — QR 재스캔 등으로 인한 중복 등록 방지
    const duplicate = await this.prisma.member.findFirst({
      where: {
        name: dto.name,
        birthDate: new Date(dto.birthDate),
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
        birthDate: new Date(dto.birthDate),
        grade: dto.grade,
        gender: dto.gender,
        isGuest: dto.isGuest,
        consentedAt: new Date(), // DTO에서 consent=true 검증 통과한 시각을 동의 이력으로 기록
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
