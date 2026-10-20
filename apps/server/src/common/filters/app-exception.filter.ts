import { ArgumentsHost, Catch, ConflictException } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { Prisma } from '../../generated/prisma/client';

// 전역 예외 필터 — Sentry 보고(500대만)는 그대로, DB 고유 제약 위반(P2002)만 409로 바꾼다
// 확인 뒤 만드는 곳은 잠금으로 막지만, 빠진 경로가 있어도 연타 한 번이 500·Sentry 알림이 되지 않게
@Catch()
export class AppExceptionFilter extends SentryGlobalFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return super.catch(new ConflictException('이미 처리된 요청이에요. 화면을 새로고침해 주세요.'), host);
    }
    return super.catch(exception, host);
  }
}
