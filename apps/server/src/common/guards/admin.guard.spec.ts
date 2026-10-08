import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard, isAdminPasscode, passcodeLockout } from './admin.guard';

const PASSCODE = 'correct-passcode';

const contextFor = (passcode: string | undefined, ip = '1.1.1.1') =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ ip, headers: passcode === undefined ? {} : { 'x-admin-passcode': passcode } }),
    }),
  }) as unknown as ExecutionContext;

describe('AdminGuard 연속 실패 잠금', () => {
  const guard = new AdminGuard();
  const original = process.env.ADMIN_PASSCODE;

  beforeEach(() => {
    process.env.ADMIN_PASSCODE = PASSCODE;
    passcodeLockout.reset();
    jest.useRealTimers();
  });
  afterAll(() => {
    process.env.ADMIN_PASSCODE = original;
    passcodeLockout.reset();
  });

  it('맞으면 통과, 틀리면 401', () => {
    expect(guard.canActivate(contextFor(PASSCODE))).toBe(true);
    expect(() => guard.canActivate(contextFor('wrong'))).toThrow(UnauthorizedException);
  });

  it('10번 틀리면 잠기고, 잠긴 동안엔 맞는 패스코드도 429', () => {
    for (let i = 0; i < 9; i++) expect(() => guard.canActivate(contextFor('wrong'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor('wrong'))).toThrow(HttpException); // 10번째에 잠김
    try {
      guard.canActivate(contextFor(PASSCODE));
      fail('잠긴 동안 통과하면 안 된다');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
    }
    // 다른 접속은 영향 없음
    expect(guard.canActivate(contextFor(PASSCODE, '2.2.2.2'))).toBe(true);
  });

  it('15분이 지나면 풀린다', () => {
    jest.useFakeTimers({ now: new Date('2026-10-08T10:00:00Z') });
    for (let i = 0; i < 10; i++) expect(() => guard.canActivate(contextFor('wrong'))).toThrow();
    jest.setSystemTime(new Date('2026-10-08T10:16:00Z'));
    expect(guard.canActivate(contextFor(PASSCODE))).toBe(true);
  });

  it('성공하면 실패 횟수가 초기화된다', () => {
    for (let i = 0; i < 9; i++) expect(() => guard.canActivate(contextFor('wrong'))).toThrow(UnauthorizedException);
    expect(guard.canActivate(contextFor(PASSCODE))).toBe(true);
    for (let i = 0; i < 9; i++) expect(() => guard.canActivate(contextFor('wrong'))).toThrow(UnauthorizedException);
  });

  it('공개 검색의 패스코드 확인도 실패로 세고, 헤더가 없으면 세지 않는다', () => {
    for (let i = 0; i < 20; i++) expect(isAdminPasscode(undefined, '3.3.3.3')).toBe(false);
    expect(isAdminPasscode(PASSCODE, '3.3.3.3')).toBe(true);
    for (let i = 0; i < 10; i++) expect(isAdminPasscode('wrong', '3.3.3.3')).toBe(false);
    expect(isAdminPasscode(PASSCODE, '3.3.3.3')).toBe(false); // 잠겨서 맞아도 운영진으로 안 봄
    expect(() => guard.canActivate(contextFor(PASSCODE, '3.3.3.3'))).toThrow(HttpException);
  });
});
