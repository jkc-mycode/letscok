import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService], // 체크인(attendances)에서 회원 응답 변환 재사용
})
export class MembersModule {}
