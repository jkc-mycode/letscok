import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IMember } from '@letscok/shared-types';
import { CreateMemberDto } from './dto/create-member.dto';
import { MembersService } from './members.service';

// 등록·검색 모두 모임원이 QR 진입 후 직접 쓰는 공개 API (운영진 가드 없음)
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  // 등록은 전역 제한보다 엄격하게 — 스크립트로 가짜 회원을 쏟아붓는 것 방지
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@Body() dto: CreateMemberDto): Promise<IApiResponse<IMember>> {
    return { success: true, data: await this.membersService.create(dto) };
  }

  @Get('search')
  async search(@Query('name') name?: string): Promise<IApiResponse<IMember[]>> {
    if (!name?.trim()) {
      throw new BadRequestException('검색할 이름을 입력해주세요.');
    }
    return { success: true, data: await this.membersService.search(name.trim()) };
  }
}
