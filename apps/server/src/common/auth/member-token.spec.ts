import { signMemberToken, verifyMemberToken } from './member-token';

describe('모임원 본인 확인 값', () => {
  const original = process.env.ADMIN_TOKEN_SECRET;
  afterEach(() => {
    process.env.ADMIN_TOKEN_SECRET = original;
  });

  it('같은 회원이면 맞고, 다른 회원 값이나 형식이 다른 값은 거부한다', () => {
    process.env.ADMIN_TOKEN_SECRET = 'qa-secret';
    const token = signMemberToken('qa-member-a') as string;
    expect(verifyMemberToken('qa-member-a', token)).toBe(true);
    expect(verifyMemberToken('qa-member-b', token)).toBe(false);
    expect(verifyMemberToken('qa-member-a', undefined)).toBe(false);
    expect(verifyMemberToken('qa-member-a', ['x'])).toBe(false);
  });

  it('비밀값이 바뀌면 예전 값은 무효다', () => {
    process.env.ADMIN_TOKEN_SECRET = 'qa-secret';
    const token = signMemberToken('qa-member-a');
    process.env.ADMIN_TOKEN_SECRET = 'qa-secret-2';
    expect(verifyMemberToken('qa-member-a', token)).toBe(false);
  });

  it('비밀값이 없으면 값을 만들지 않고 늘 거부한다', () => {
    delete process.env.ADMIN_TOKEN_SECRET;
    expect(signMemberToken('qa-member-a')).toBeNull();
    expect(verifyMemberToken('qa-member-a', 'anything')).toBe(false);
  });
});
