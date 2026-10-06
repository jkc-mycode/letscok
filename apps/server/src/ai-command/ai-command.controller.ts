import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IAiCommandResult, IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { AiCommandService } from './ai-command.service';
import { AiCommandDto } from './dto/ai-command.dtos';

// 운영진 전용 + 분당 10회 — 외부에서 AI 비용을 발생시킬 수 없게(AI 체크인과 같은 기준)
@Controller()
@UseGuards(AdminGuard)
export class AiCommandController {
  constructor(private readonly aiCommandService: AiCommandService) {}

  // 결과는 미리보기·후보·안내뿐 — 게임 종료·휴식·호출·조합 생성은 웹이 확인 후 기존 API로 실행한다(체크인만 예외: 기존 규칙대로 확실한 사람은 바로)
  @Post('sessions/:sessionId/ai-command')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async run(
    @Param('sessionId') sessionId: string,
    @Body() dto: AiCommandDto,
  ): Promise<IApiResponse<IAiCommandResult>> {
    return { success: true, data: await this.aiCommandService.run(sessionId, dto.text) };
  }
}
