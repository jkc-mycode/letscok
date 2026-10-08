import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
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

// 패스코드 연속 실패 잠금 — 요청 제한(분당 60회)만으로는 하루 수만 번 맞혀 볼 수 있다
// 같은 접속(IP)에서 15분 안에 10번 틀리면 15분 동안 맞는 패스코드도 거부한다(맞혔는지 알 수 없게)
// 메모리에 둔다 — 서버 한 대(Render)라 충분하고, 재시작되면 풀리는 정도는 감수
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED = 1000; // 접속 주소를 바꿔 가며 기록을 불리는 경우의 상한

export const LOCKED_MESSAGE = '패스코드를 여러 번 틀려 15분 동안 잠겼어요. 잠시 후 다시 시도해 주세요.';

class PasscodeLockout {
  private readonly records = new Map<string, { fails: number; firstAt: number; lockedUntil: number }>();

  isLocked(ip: string, now = Date.now()): boolean {
    const record = this.records.get(ip);
    if (!record) return false;
    if (record.lockedUntil > now) return true;
    if (record.lockedUntil && record.lockedUntil <= now) this.records.delete(ip); // 잠금이 풀리면 처음부터
    return false;
  }

  // 실패를 세고, 이번 실패로 잠겼으면 true
  fail(ip: string, now = Date.now()): boolean {
    let record = this.records.get(ip);
    if (!record || now - record.firstAt > WINDOW_MS) {
      if (!record && this.records.size >= MAX_TRACKED) this.prune(now);
      record = { fails: 0, firstAt: now, lockedUntil: 0 };
      this.records.set(ip, record);
    }
    record.fails += 1;
    if (record.fails >= MAX_FAILS) record.lockedUntil = now + LOCK_MS;
    return record.lockedUntil > now;
  }

  succeed(ip: string): void {
    this.records.delete(ip);
  }

  reset(): void {
    this.records.clear();
  }

  private prune(now: number): void {
    for (const [ip, record] of this.records) {
      if (record.lockedUntil <= now && now - record.firstAt > WINDOW_MS) this.records.delete(ip);
    }
    // 그래도 꽉 차 있으면 가장 오래된 것부터 — 잠금 기록을 지우는 대신 메모리를 지킨다
    while (this.records.size >= MAX_TRACKED) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }
}

export const passcodeLockout = new PasscodeLockout();

type PasscodeResult = 'ok' | 'wrong' | 'locked';

// 패스코드 확인의 단일 지점 — 가드와 공개 API 둘 다 여기를 거쳐 실패가 함께 세진다
function checkPasscode(passcode: unknown, ip: string): PasscodeResult {
  if (passcodeLockout.isLocked(ip)) return 'locked';
  const expected = process.env.ADMIN_PASSCODE as string;
  if (typeof passcode === 'string' && safeCompare(passcode, expected)) {
    passcodeLockout.succeed(ip);
    return 'ok';
  }
  return passcodeLockout.fail(ip) ? 'locked' : 'wrong';
}

// 공개 API가 운영진에게만 더 많이 보여 줄 때 — 막지 않고 운영진인지 여부만 판단
// 틀린 패스코드도 실패로 센다(이 응답 차이로 패스코드를 맞혀 보는 통로가 되지 않게). 헤더가 없으면 세지 않는다
export function isAdminPasscode(passcode: unknown, ip: string): boolean {
  if (!process.env.ADMIN_PASSCODE || passcode === undefined) return false;
  return checkPasscode(passcode, ip) === 'ok';
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
    const result = checkPasscode(passcode, request.ip ?? 'unknown');
    if (result === 'locked') throw new HttpException(LOCKED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    if (result === 'wrong') throw new UnauthorizedException('운영진 패스코드가 올바르지 않습니다.');
    return true;
  }
}
