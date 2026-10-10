import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IApiResponse, IReceiptReadResult } from '@letscok/shared-types';
import { AdminGuard } from '../common/guards/admin.guard';
import { SettlementService } from './settlement.service';

// 영수증 업로드 제한 — 웹이 긴 변 1568px JPEG로 줄여 보낸다(AI 체크인과 같은 기준). 1차·2차에 길어서 나눠 찍은 영수증까지 5장
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// 운영진 전용 + 분당 10회 — 외부에서 AI 비용을 발생시킬 수 없게. 모임과 무관(끝난 뒤에도 정산)
@Controller('settlement')
@UseGuards(AdminGuard)
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  // 영수증 사진 → 품목·분류·총액. 이미지는 메모리에서만 처리하고 저장하지 않는다
  @Post('receipt')
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
  async readReceipt(
    @UploadedFiles() images: Express.Multer.File[] | undefined,
  ): Promise<IApiResponse<IReceiptReadResult>> {
    if (!images || images.length === 0) {
      throw new BadRequestException('영수증 사진을 올려주세요.');
    }
    return { success: true, data: await this.settlementService.readReceipt(images) };
  }
}
