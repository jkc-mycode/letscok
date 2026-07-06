import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { IApiResponse, IMember } from '@letscok/shared-types';
import { CreateMemberDto } from './dto/create-member.dto';
import { MembersService } from './members.service';

// 등록·검색 모두 모임원이 QR 진입 후 직접 쓰는 공개 API (운영진 가드 없음)
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
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
