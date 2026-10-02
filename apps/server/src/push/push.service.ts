import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IPushPayload,
  IPushPublicKey,
  ISubscribePushDto,
} from '@letscok/shared-types';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

// 한 회원이 등록할 수 있는 기기 수 — 가드 없는 공개 API라 무한 등록을 막는다
const MAX_SUBSCRIPTIONS_PER_MEMBER = 5;

// 5분 지나 도착한 "코트로 오세요"는 오히려 혼란 — 푸시 서비스가 그 뒤엔 버린다
const PUSH_TTL_SECONDS = 300;

// 게임 관련 알림은 tag 하나를 공유 — 조합 알림 뒤 배정 알림이 오면 알림 센터에 최신 것만 남는다
const GAME_TAG = 'letscok-game';

export interface IPushMessage {
  memberId: string;
  payload: IPushPayload;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey: string | null = null;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    // 키가 없으면 비활성으로 정상 기동 — 로컬·CI·테스트는 키 없이 돌아간다 (Sentry DSN과 같은 방식)
    if (!publicKey || !privateKey || !subject) {
      this.logger.warn('VAPID 키가 없어 웹 푸시를 비활성화합니다.');
      return;
    }
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.publicKey = publicKey;
    } catch (error) {
      this.logger.error('VAPID 키 형식이 잘못돼 웹 푸시를 비활성화합니다.', (error as Error).stack);
    }
  }

  getPublicKey(): IPushPublicKey {
    return { publicKey: this.publicKey };
  }

  // 같은 기기(endpoint)를 다른 사람이 쓰게 되면 memberId만 바뀐다
  async subscribe(dto: ISubscribePushDto, userAgent?: string): Promise<void> {
    const member = await this.prisma.member.findFirst({
      where: { id: dto.memberId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('등록되지 않은 모임원입니다.');
    }

    const data = {
      memberId: dto.memberId,
      p256dh: dto.p256dh,
      auth: dto.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });

    // 상한 초과분은 오래된 기기부터 정리 — 바꾼 폰의 옛 구독이 자연스럽게 밀려난다
    const stale = await this.prisma.pushSubscription.findMany({
      where: { memberId: dto.memberId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // 같은 밀리초 등록 시에도 순서 고정
      skip: MAX_SUBSCRIPTIONS_PER_MEMBER,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  async unsubscribe(endpoint: string): Promise<{ deleted: number }> {
    const { count } = await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { deleted: count };
  }

  // 게임 알림 — 코트 배정·대기 조합 등록·교체 투입 공용. 게임 상태로 문구가 갈린다
  // onlyAttendanceId: 교체로 들어온 1명에게만 보낼 때
  notifyGame(gameId: string, onlyAttendanceId?: string): void {
    if (!this.publicKey) return;
    this.gameMessages(gameId, onlyAttendanceId)
      .then((messages) => this.deliver(messages))
      .catch((error: Error) => this.logger.error('게임 알림 발송 실패', error.stack));
  }

  notifyShuttleConfirmed(memberId: string): void {
    this.notify([
      {
        memberId,
        payload: { title: '콕 확인 완료', body: '이제 게임에 들어갈 수 있어요', tag: GAME_TAG, url: '/m' },
      },
    ]);
  }

  // 운영진 호출 — 결과(받은 기기 수)를 운영진에게 보여줘야 해서 기다렸다 돌려준다
  // tag를 게임 알림과 분리: 뒤이은 게임 알림에 덮여 사라지면 안 된다
  callMember(memberId: string): Promise<number> {
    return this.deliver([
      {
        memberId,
        payload: { title: '운영진이 찾고 있어요', body: '관제판 쪽으로 와주세요', tag: 'letscok-call', url: '/m' },
      },
    ]);
  }

  // 코트 [다시 알림] — 배정 알림을 4명에게 다시 보낸다
  async resendGame(gameId: string): Promise<number> {
    return this.deliver(await this.gameMessages(gameId));
  }

  // 커밋 후 게임을 다시 읽어 받는 사람별 문구를 만든다 — 함께 뛰는 사람은 본인을 뺀 3명
  async gameMessages(gameId: string, onlyAttendanceId?: string): Promise<IPushMessage[]> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { court: true, players: { include: { attendance: { include: { member: true } } } } },
    });
    if (!game || (game.status !== 'PLAYING' && game.status !== 'QUEUED')) return [];

    let title: string;
    let lead: string | null = null;
    if (game.status === 'PLAYING') {
      title = `🏸 ${game.court?.courtNo ?? ''}번 코트로 오세요`;
    } else {
      // 대기 순번 = 이 조합보다 앞서거나 같은 순서의 대기 조합 수
      const position = await this.prisma.game.count({
        where: { sessionId: game.sessionId, status: 'QUEUED', queueOrder: { lte: game.queueOrder ?? 0 } },
      });
      title = '다음 게임 조합에 들어갔어요';
      lead = `대기 ${position}번째`;
    }

    return game.players
      .filter((player) => !onlyAttendanceId || player.attendanceId === onlyAttendanceId)
      .map((player) => {
        const others = game.players
          .filter((other) => other.id !== player.id)
          .map((other) => other.attendance.member.name);
        const body = [lead, `함께: ${others.join(', ')}`].filter(Boolean).join('\n');
        return {
          memberId: player.attendance.memberId,
          payload: { title, body, tag: GAME_TAG, url: '/m' },
        };
      });
  }

  // 변경을 일으킨 서비스가 응답을 기다리지 않게 fire-and-forget (broadcastSnapshot과 같은 원칙)
  notify(messages: IPushMessage[]): void {
    this.deliver(messages).catch((error: Error) =>
      this.logger.error('푸시 발송 실패', error.stack),
    );
  }

  // 실제 발송 — 성공한 기기 수를 돌려준다(호출 버튼의 "알림 미등록" 판정·테스트용)
  async deliver(messages: IPushMessage[]): Promise<number> {
    if (!this.publicKey || messages.length === 0) return 0;

    const payloadByMember = new Map(messages.map((m) => [m.memberId, m.payload]));
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { memberId: { in: [...payloadByMember.keys()] } },
    });

    const results = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payloadByMember.get(sub.memberId)),
            { TTL: PUSH_TTL_SECONDS, urgency: 'high' }, // high: Android 절전 모드에서도 즉시 전달 시도
          );
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastSentAt: new Date() },
          });
          return true;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          // 404·410 = 기기가 구독을 끊었거나 앱을 지웠다 — 다시 보낼 일이 없으니 정리
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
          } else {
            this.logger.warn(`푸시 발송 실패 (status=${statusCode ?? '없음'}, member=${sub.memberId})`);
          }
          return false;
        }
      }),
    );
    return results.filter(Boolean).length;
  }
}
