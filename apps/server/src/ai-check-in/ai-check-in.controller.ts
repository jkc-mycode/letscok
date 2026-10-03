import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IAiCheckInResult, IAiCheckInStatus, IApiResponse } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { AiCheckInService } from './ai-check-in.service';
import { AiCheckInCommandDto } from './dto/ai-check-in.dtos';

// 캡처 업로드 제한 — 웹이 긴 변 1568px JPEG로 줄여 보내므로 장당 1.5MB면 넉넉하다
// (원본 수 MB를 여러 장 받으면 Render 무료 인스턴스 512MB 메모리가 위험)
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// AI 체크인은 전부 운영진 전용 + 분당 10회 — 외부에서 비용을 발생시킬 수 없게
@Controller()
@UseGuards(AdminGuard)
export class AiCheckInController {
  constructor(private readonly aiCheckInService: AiCheckInService) {}

  // 웹이 AI 영역을 보여줄지 판단 (키가 없으면 enabled=false)
  @Get('ai-check-in/status')
  status(): IApiResponse<IAiCheckInStatus> {
    return { success: true, data: this.aiCheckInService.status() };
  }

  // 참석 신청 목록 캡처 → 확실한 사람만 자동 체크인. 이미지는 메모리에서만 처리하고 저장하지 않는다
  @Post('sessions/:sessionId/ai-check-in/images')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FilesInterceptor('images', MAX_IMAGES, {
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (IMAGE_TYPES.includes(file.mimetype)) callback(null, true);
        else callback(new BadRequestException('이미지 파일(JPG·PNG·WEBP)만 올릴 수 있어요.'), false);
      },
    }),
  )
  async checkInFromImages(
    @Param('sessionId') sessionId: string,
    @UploadedFiles() images: Express.Multer.File[] | undefined,
  ): Promise<IApiResponse<IAiCheckInResult>> {
    if (!images || images.length === 0) {
      throw new BadRequestException('참석 신청 목록 캡처를 올려주세요.');
    }
    return {
      success: true,
      data: await this.aiCheckInService.checkInFromImages(sessionId, images),
    };
  }

  // 운영진 자연어 명령 — 체크인만 지원(그 밖의 요청엔 고정 안내만)
  @Post('sessions/:sessionId/ai-check-in/command')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async checkInFromCommand(
    @Param('sessionId') sessionId: string,
    @Body() dto: AiCheckInCommandDto,
  ): Promise<IApiResponse<IAiCheckInResult>> {
    return {
      success: true,
      data: await this.aiCheckInService.checkInFromCommand(sessionId, dto.text),
    };
  }
}
