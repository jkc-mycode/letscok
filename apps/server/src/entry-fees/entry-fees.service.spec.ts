import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntryFeesService } from './entry-fees.service';

const prisma = new PrismaService();
const service = new EntryFeesService(prisma);
let seq = 0;

async function seedSession(date = '2026-01-08') {
  return prisma.session.create({ data: { date: new Date(date), checkInCode: '0101' } });
}

async function seedAttendance(sessionId: string, name: string, isGuest = false) {
  const member = await prisma.member.create({
    data: { name: `${name}${++seq}`, grade: 'C', gender: 'MALE', isGuest, birthDate: isGuest ? null : new Date('2000-01-01') },
  });
  return prisma.attendance.create({ data: { sessionId, memberId: member.id } });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE game_players, games, attendances, courts, sessions, members CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('EntryFeesService', () => {
  it('설정 → 받는 사람은 자동으로 냄, 체크·해제, 이 모임에 없는 받는 사람은 409', async () => {
    const session = await seedSession();
    const payee = await seedAttendance(session.id, '가');
    const other = await seedAttendance(session.id, '나');
    const guest = await seedAttendance(session.id, '다', true);

    const set = await service.update(session.id, { fee: 6000, payeeAttendanceId: payee.id, account: ' 국민 123-456 홍길동 ' });
    expect(set.fee).toBe(6000);
    expect(set.account).toBe('국민 123-456 홍길동');
    const paidOf = (fee: Awaited<ReturnType<typeof service.get>>) => Object.fromEntries(fee.rows.map((r) => [r.attendanceId, r.paid]));
    expect(paidOf(set)).toEqual({ [payee.id]: true, [other.id]: false, [guest.id]: false });
    expect(set.rows.find((r) => r.attendanceId === guest.id)?.isGuest).toBe(true);

    const checked = await service.setPaid(other.id, { paid: true });
    expect(paidOf(checked)[other.id]).toBe(true);
    const unchecked = await service.setPaid(other.id, { paid: false });
    expect(paidOf(unchecked)[other.id]).toBe(false);

    const elsewhere = await seedSession('2026-01-01');
    const stranger = await seedAttendance(elsewhere.id, '라');
    await expect(service.update(session.id, { fee: 6000, payeeAttendanceId: stranger.id, account: null })).rejects.toThrow(ConflictException);
  });

  it('목록은 고른 사람만 — 받는 사람은 자동으로 들고 못 빼며, 뺀 사람은 받음 표시도 지운다', async () => {
    const session = await seedSession();
    const payee = await seedAttendance(session.id, '가');
    const friend = await seedAttendance(session.id, '나');
    const solo = await seedAttendance(session.id, '다'); // 각자 낸 사람 — 목록에 안 넣는다
    const includedOf = (fee: Awaited<ReturnType<typeof service.get>>) =>
      Object.fromEntries(fee.rows.map((r) => [r.attendanceId, r.included]));

    expect(includedOf(await service.get(session.id))).toEqual({ [payee.id]: false, [friend.id]: false, [solo.id]: false });
    const set = await service.update(session.id, { fee: 2800, payeeAttendanceId: payee.id, account: null });
    expect(includedOf(set)[payee.id]).toBe(true);

    const added = await service.setMembers(session.id, { attendanceIds: [friend.id], included: true });
    expect(includedOf(added)).toEqual({ [payee.id]: true, [friend.id]: true, [solo.id]: false });

    await service.setPaid(friend.id, { paid: true });
    const removed = await service.setMembers(session.id, { attendanceIds: [friend.id], included: false });
    expect(removed.rows.find((r) => r.attendanceId === friend.id)).toMatchObject({ included: false, paid: false });

    await expect(service.setMembers(session.id, { attendanceIds: [payee.id], included: false })).rejects.toThrow(ConflictException);
  });

  it('콕 확인 여부가 행마다 실린다 — 웹은 확인된 사람만 [명단에서 고르기] 후보로 띄운다', async () => {
    const session = await seedSession();
    const confirmed = await seedAttendance(session.id, '가');
    const unconfirmed = await seedAttendance(session.id, '나');
    await prisma.attendance.update({ where: { id: confirmed.id }, data: { shuttleConfirmedAt: new Date() } });

    const { rows } = await service.get(session.id);
    expect(rows.find((r) => r.attendanceId === confirmed.id)?.shuttleConfirmed).toBe(true);
    expect(rows.find((r) => r.attendanceId === unconfirmed.id)?.shuttleConfirmed).toBe(false);
  });

  it('동시에 연 모임은 모임 이름이 함께 온다(창 제목·안내 문구용)', async () => {
    const plain = await seedSession();
    const labeled = await prisma.session.create({
      data: { date: new Date('2026-01-08'), checkInCode: '0102', label: '여복' },
    });

    expect((await service.get(plain.id)).label).toBeNull();
    expect((await service.get(labeled.id)).label).toBe('여복');
  });

  it('다른 모임 출석이 섞이면 아무도 바꾸지 않고 409', async () => {
    const session = await seedSession();
    const mine = await seedAttendance(session.id, '가');
    const elsewhere = await seedSession('2026-01-01');
    const stranger = await seedAttendance(elsewhere.id, '나');

    await expect(service.setMembers(session.id, { attendanceIds: [mine.id, stranger.id], included: true })).rejects.toThrow(
      ConflictException,
    );
    expect((await service.get(session.id)).rows[0].included).toBe(false);
  });

  it('직전 모임의 금액·계좌·받는 사람을 불러오기용으로 준다', async () => {
    const last = await seedSession('2026-01-01');
    const payee = await seedAttendance(last.id, '가');
    await service.update(last.id, { fee: 5000, payeeAttendanceId: payee.id, account: '신한 111 김가' });

    const today = await seedSession('2026-01-08');
    const fee = await service.get(today.id);
    expect(fee.fee).toBeNull();
    expect(fee.previous).toEqual({ fee: 5000, account: '신한 111 김가', payeeMemberId: payee.memberId, payeeName: expect.stringMatching(/^가/) });
  });
});
