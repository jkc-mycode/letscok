import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IMember } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreateMemberDto } from './dto/create-member.dto';
import { MembersService } from './members.service';

// 검색은 공개(모임원이 본인을 찾아 체크인), 등록은 운영진 전용
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  // 자가 가입 차단 — 운영진이 정회원·게스트를 모두 사전 등록하므로 공개 등록 경로가 필요 없다
  // 열어두면 코드를 아는 외부인이 없던 회원을 만들어 들어올 수 있다
  @Post()
  @UseGuards(AdminGuard)
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
