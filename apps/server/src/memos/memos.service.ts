import { Injectable, NotFoundException } from '@nestjs/common';
import { IAdminMemo } from '@letscok/shared-types';
import { AdminMemo } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

// 관제판 운영 메모 — 세션 무관 전역(처리 전 요청·건강 메모는 다음 모임으로 이어진다), 삭제 = 완료 처리.
// 이름·건강 정보가 적히므로 공개 응답에 절대 안 싣고 admin 경로로만 노출.
// 변경 시 스냅샷 브로드캐스트는 다른 운영진 기기의 "메모 재조회 트리거"로만 쓴다
@Injectable()
export class MemosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // 오래된 순 — 적은 순서대로 읽힌다
  async list(): Promise<IAdminMemo[]> {
    const memos = await this.prisma.adminMemo.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return memos.map(toMemoResponse);
  }

  async create(content: string): Promise<IAdminMemo> {
    const memo = await this.prisma.adminMemo.create({
      data: { content: content.trim() },
    });
    await this.broadcastIfSessionOpen();
    return toMemoResponse(memo);
  }

  async remove(id: string): Promise<IAdminMemo> {
    const memo = await this.prisma.adminMemo.findUnique({ where: { id } });
    if (!memo) {
      throw new NotFoundException('메모를 찾을 수 없습니다.');
    }
    // 운영 메모라 soft-delete 불필요 — 하드 삭제
    await this.prisma.adminMemo.delete({ where: { id } });
    await this.broadcastIfSessionOpen();
    return toMemoResponse(memo);
  }

  // 전체 초기화 — 프론트에서 2탭 확인 후 호출
  async clear(): Promise<{ deleted: number }> {
    const { count } = await this.prisma.adminMemo.deleteMany({});
    await this.broadcastIfSessionOpen();
    return { deleted: count };
  }

  // 메모는 세션 무관이지만 실시간 룸은 세션 단위 — 진행 중 모임이 있을 때만 재조회 신호를 보낸다
  // (모임 밖 변경은 어차피 관제판이 떠 있지 않아 신호 받을 기기가 없다)
  private async broadcastIfSessionOpen(): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { status: 'OPEN' },
      select: { id: true },
    });
    if (session) this.realtime.broadcastSnapshot(session.id);
  }
}

function toMemoResponse(memo: AdminMemo): IAdminMemo {
  return {
    id: memo.id,
    content: memo.content,
    createdAt: memo.createdAt.toISOString(),
  };
}
