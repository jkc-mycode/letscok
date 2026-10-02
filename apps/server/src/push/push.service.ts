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
