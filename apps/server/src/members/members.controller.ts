import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IMember, IMemberSummary } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MembersService } from './members.service';

// 검색은 공개(모임원이 본인을 찾아 체크인), 등록·명단 관리는 운영진 전용
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

  // 명단 목록 — [모임원 관리] 화면 전용, 삭제 회원·출석 집계 포함
  @Get()
  @UseGuards(AdminGuard)
  async list(): Promise<IApiResponse<IMemberSummary[]>> {
    return { success: true, data: await this.membersService.list() };
  }

  // 정보 수정 (이름·급수·성별·생년월일·역할) + 게스트→정회원 승격(isGuest:false)
  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<IApiResponse<IMember>> {
    return { success: true, data: await this.membersService.update(id, dto) };
  }

  // 삭제(soft) — 실수 대비 복구 가능. 진행 중 모임 체크인자는 409
  @Delete(':id')
  @UseGuards(AdminGuard)
  async remove(@Param('id') id: string): Promise<IApiResponse<IMember>> {
    return { success: true, data: await this.membersService.remove(id) };
  }

  @Patch(':id/restore')
  @UseGuards(AdminGuard)
  async restore(@Param('id') id: string): Promise<IApiResponse<IMember>> {
    return { success: true, data: await this.membersService.restore(id) };
  }

  // 익명화 삭제 — 본인의 개인정보 삭제 요청용. 복구 불가(웹에서 2탭 확인)
  @Patch(':id/anonymize')
  @UseGuards(AdminGuard)
  async anonymize(@Param('id') id: string): Promise<IApiResponse<IMember>> {
    return { success: true, data: await this.membersService.anonymize(id) };
  }
}
