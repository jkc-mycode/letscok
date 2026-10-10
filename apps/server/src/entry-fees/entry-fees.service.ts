import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IEntryFee } from '@letscok/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { SetEntryPaidDto, UpdateEntryFeeDto } from './dto/entry-fee.dto';

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

// 오늘의 입장비 — 한 사람이 몰아서 내고 나머지가 송금, 운영진이 받은 사람을 체크한다
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
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        entryFee: dto.fee,
        entryPayeeAttendanceId: dto.payeeAttendanceId ?? null,
        entryAccount: dto.account?.trim() || null,
      },
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
