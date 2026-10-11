import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IEntryFee } from '@letscok/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SetEntryMembersDto, SetEntryPaidDto, UpdateEntryFeeDto } from './dto/entry-fee.dto';

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

// 오늘의 입장비 — 한 사람이 몰아서 내고 나머지가 송금, 운영진이 받은 사람을 체크한다
// 다 같이 한 사람에게 내는 게 아니라(각자 내는 사람도 있다) 운영진이 출석자 중 고른 사람만 목록에 든다(entryIncluded)
// 모임이 끝난 뒤에도 늦게 보낸 사람을 체크할 수 있게 모임 상태는 보지 않는다. 퇴장한 사람도 왔던 사람이라 포함
@Injectable()
export class EntryFeesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(sessionId: string): Promise<IEntryFee> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { attendances: { include: { member: true } } },
    });
    if (!session) throw new NotFoundException('모임을 찾을 수 없습니다.');

    // 직전 모임 값 — 계좌를 적어 둔 가장 최근 모임(불러오기용)
    const prev = await this.prisma.session.findFirst({
      where: { id: { not: sessionId }, entryAccount: { not: null }, date: { lte: session.date } },
      orderBy: [{ date: 'desc' }, { openedAt: 'desc' }],
      include: { attendances: { select: { id: true, memberId: true, member: { select: { name: true } } } } },
    });
    const prevPayee = prev?.attendances.find((a) => a.id === prev.entryPayeeAttendanceId);

    const rows = session.attendances
      .map((a) => {
        const isPayee = a.id === session.entryPayeeAttendanceId;
        return {
          attendanceId: a.id,
          memberId: a.memberId,
          name: a.member.name,
          isGuest: a.member.isGuest,
          paid: isPayee || a.entryPaidAt !== null,
          paidAt: a.entryPaidAt?.toISOString() ?? null,
          isPayee,
          included: isPayee || a.entryIncluded,
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name, 'ko'));

    return {
      sessionId: session.id,
      date: toDateString(session.date),
      fee: session.entryFee,
      payeeAttendanceId: session.entryPayeeAttendanceId,
      account: session.entryAccount,
      previous: prev?.entryAccount
        ? {
            fee: prev.entryFee,
            account: prev.entryAccount,
            payeeMemberId: prevPayee?.memberId ?? null,
            payeeName: prevPayee?.member.name ?? null,
          }
        : null,
      rows,
    };
  }

  async update(sessionId: string, dto: UpdateEntryFeeDto): Promise<IEntryFee> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('모임을 찾을 수 없습니다.');
    if (dto.payeeAttendanceId) {
      const payee = await this.prisma.attendance.findFirst({ where: { id: dto.payeeAttendanceId, sessionId } });
      if (!payee) throw new ConflictException('받는 사람은 이 모임에 온 사람이어야 해요.');
    }
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: {
          entryFee: dto.fee,
          entryPayeeAttendanceId: dto.payeeAttendanceId ?? null,
          entryAccount: dto.account?.trim() || null,
        },
      }),
      // 받는 사람은 목록에 들어 있어야 한다 — 받는 사람을 바꿔 빠져도 넣어 둔 표시는 남아 목록에 그대로
      ...(dto.payeeAttendanceId
        ? [this.prisma.attendance.update({ where: { id: dto.payeeAttendanceId }, data: { entryIncluded: true } })]
        : []),
    ]);
    return this.get(sessionId);
  }

  // 목록에 넣기·빼기 — 뺀 사람은 받음 표시도 지운다(다시 넣으면 처음부터). 받는 사람은 뺄 수 없다
  async setMembers(sessionId: string, dto: SetEntryMembersDto): Promise<IEntryFee> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('모임을 찾을 수 없습니다.');
    if (!dto.included && session.entryPayeeAttendanceId && dto.attendanceIds.includes(session.entryPayeeAttendanceId)) {
      throw new ConflictException('받는 사람은 목록에서 뺄 수 없어요. 받는 사람을 먼저 바꿔주세요.');
    }
    // 다른 모임 출석이 섞이면 아무것도 바꾸지 않는다(일부만 바뀐 채 오류가 나지 않게 먼저 센다)
    const ids = [...new Set(dto.attendanceIds)];
    const found = await this.prisma.attendance.count({ where: { id: { in: ids }, sessionId } });
    if (found !== ids.length) {
      throw new ConflictException('이 모임에 온 사람만 고를 수 있어요.');
    }
    await this.prisma.attendance.updateMany({
      where: { id: { in: ids }, sessionId },
      data: dto.included ? { entryIncluded: true } : { entryIncluded: false, entryPaidAt: null },
    });
    return this.get(sessionId);
  }

  async setPaid(attendanceId: string, dto: SetEntryPaidDto): Promise<IEntryFee> {
    const attendance = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!attendance) throw new NotFoundException('출석 기록을 찾을 수 없습니다.');
    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: { entryPaidAt: dto.paid ? (attendance.entryPaidAt ?? new Date()) : null },
    });
    return this.get(attendance.sessionId);
  }
}
