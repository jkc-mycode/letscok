import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { issueAdminToken, verifyAdminToken } from '../auth/admin-token';
import { AdminGuard, isAdminRequest, passcodeLockout } from './admin.guard';

const PASSCODE = 'correct-passcode';

const contextFor = (passcode: string | undefined, ip = '1.1.1.1', authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: {
          ...(passcode !== undefined && { 'x-admin-passcode': passcode }),
          ...(authorization !== undefined && { authorization }),
        },
      }),
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
    for (let i = 0; i < 20; i++) expect(isAdminRequest({}, '3.3.3.3')).toBe(false);
    expect(isAdminRequest({ passcode: PASSCODE }, '3.3.3.3')).toBe(true);
    for (let i = 0; i < 10; i++) expect(isAdminRequest({ passcode: 'wrong' }, '3.3.3.3')).toBe(false);
    expect(isAdminRequest({ passcode: PASSCODE }, '3.3.3.3')).toBe(false); // 잠겨서 맞아도 운영진으로 안 봄
    expect(() => guard.canActivate(contextFor(PASSCODE, '3.3.3.3'))).toThrow(HttpException);
  });
});

describe('운영진 출입증(토큰)', () => {
  const guard = new AdminGuard();
  const original = { passcode: process.env.ADMIN_PASSCODE, secret: process.env.ADMIN_TOKEN_SECRET };

  beforeEach(() => {
    process.env.ADMIN_PASSCODE = PASSCODE;
    process.env.ADMIN_TOKEN_SECRET = 'test-secret';
    passcodeLockout.reset();
  });
  afterAll(() => {
    process.env.ADMIN_PASSCODE = original.passcode;
    process.env.ADMIN_TOKEN_SECRET = original.secret;
  });

  it('발급한 토큰으로 통과, 공개 검색에서도 운영진으로 인정', () => {
    const issued = issueAdminToken();
    expect(issued).not.toBeNull();
    expect(guard.canActivate(contextFor(undefined, '1.1.1.1', `Bearer ${issued!.token}`))).toBe(true);
    expect(isAdminRequest({ authorization: `Bearer ${issued!.token}` }, '1.1.1.1')).toBe(true);
  });

  it('30일이 지나면 무효', () => {
    const issued = issueAdminToken(Date.parse('2026-10-08T00:00:00Z'))!;
    expect(verifyAdminToken(issued.token, Date.parse('2026-11-06T00:00:00Z'))).toBe(true);
    expect(verifyAdminToken(issued.token, Date.parse('2026-11-08T00:00:01Z'))).toBe(false);
  });

  it('패스코드를 바꾸면 기존 토큰이 무효, 위조·변조도 401', () => {
    const { token } = issueAdminToken()!;
    process.env.ADMIN_PASSCODE = 'new-passcode';
    expect(() => guard.canActivate(contextFor(undefined, '1.1.1.1', `Bearer ${token}`))).toThrow(UnauthorizedException);
    process.env.ADMIN_PASSCODE = PASSCODE;
    const [h, , sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: 0, exp: 9999999999 })).toString('base64url');
    expect(verifyAdminToken(`${h}.${forged}.${sig}`)).toBe(false);
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyAdminToken(`${none}.${forged}.`)).toBe(false);
  });

  it('틀린 토큰은 잠금 횟수에 세지 않는다(만료 토큰 태블릿이 잠기지 않게)', () => {
    for (let i = 0; i < 15; i++) {
      expect(() => guard.canActivate(contextFor(undefined, '4.4.4.4', 'Bearer bad.token.value'))).toThrow(UnauthorizedException);
    }
    expect(guard.canActivate(contextFor(PASSCODE, '4.4.4.4'))).toBe(true);
  });

  it('비밀값이 없으면 토큰을 발급하지 않고 패스코드 방식은 그대로', () => {
    delete process.env.ADMIN_TOKEN_SECRET;
    expect(issueAdminToken()).toBeNull();
    expect(guard.canActivate(contextFor(PASSCODE))).toBe(true);
  });
});
