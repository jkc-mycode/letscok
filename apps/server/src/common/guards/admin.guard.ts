import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// 두 문자열을 길이 정보 노출 없이 상수 시간에 비교 —
// 단순 !== 비교는 일치 길이에 따라 응답 시간이 미세하게 달라져 타이밍 공격 여지가 있다
// (sha256으로 고정 길이를 만든 뒤 비교하면 원문 길이가 달라도 안전)
function safeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// 운영진 전용 API 보호 — 요청 헤더의 패스코드를 환경변수와 대조하는 단순 방식
// (개인 소모임 규모라 토큰 발급 없이 태블릿이 매 요청에 헤더를 실어 보내는 걸로 충분.
//  운영진 계정 개별화가 필요해지면 v2에서 JWT로 교체)
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const passcode = request.headers['x-admin-passcode'];

    if (!process.env.ADMIN_PASSCODE) {
      // 환경변수 누락 시 전부 거부 — 빈 패스코드로 통과되는 사고 방지
      throw new UnauthorizedException('서버에 운영진 패스코드가 설정되지 않았습니다.');
    }
    if (typeof passcode !== 'string' || !safeCompare(passcode, process.env.ADMIN_PASSCODE)) {
      throw new UnauthorizedException('운영진 패스코드가 올바르지 않습니다.');
    }
    return true;
  }
}
