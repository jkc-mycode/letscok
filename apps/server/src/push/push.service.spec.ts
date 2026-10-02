import { NotFoundException } from '@nestjs/common';
import * as webpush from 'web-push';
import { MembersService } from '../members/members.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from './push.service';

// 웹 푸시 통합 테스트 — 구독 저장은 실제 Prisma+테스트 DB, 발송(web-push)만 목으로 대체한다
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
const sendNotification = webpush.sendNotification as jest.Mock;

const realtimeStub = {
  broadcastSnapshot: () => undefined,
} as unknown as RealtimeService;

const prisma = new PrismaService();

// 키가 있어야 발송 경로가 활성화된다 — 생성자에서 읽으므로 생성 전에 심는다
const VAPID_ENV = {
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:test@example.com',
};
function createService(withKeys = true): PushService {
  for (const [key, value] of Object.entries(VAPID_ENV)) {
    if (withKeys) process.env[key] = value;
    else delete process.env[key];
  }
  return new PushService(prisma);
}

const payload = { title: '3번 코트로 오세요', body: '', tag: 'letscok-game', url: '/m' };
const keys = { p256dh: 'p256dh-key', auth: 'auth-key' };

async function createMember(name = '홍길동') {
  return prisma.member.create({ data: { name, grade: 'C' } });
}

beforeEach(async () => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE push_subscriptions, admin_memos, game_players, games, attendances, courts, sessions, members CASCADE',
  );
});

afterAll(async () => {
  for (const key of Object.keys(VAPID_ENV)) delete process.env[key];
  await prisma.$disconnect();
});

describe('subscribe', () => {
  it('같은 기기(endpoint)로 다시 구독하면 행이 늘지 않고 memberId만 바뀐다', async () => {
    const service = createService();
    const a = await createMember('김하나');
    const b = await createMember('이두울');
    const endpoint = 'https://push.example/device-1';

    await service.subscribe({ memberId: a.id, endpoint, ...keys });
    await service.subscribe({ memberId: b.id, endpoint, ...keys });

    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(b.id);
  });

  it('한 회원의 6번째 기기를 등록하면 가장 오래된 구독이 정리된다', async () => {
    const service = createService();
    const member = await createMember();
    for (let i = 1; i <= 6; i++) {
      await service.subscribe({ memberId: member.id, endpoint: `https://push.example/${i}`, ...keys });
    }

    const rows = await prisma.pushSubscription.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.endpoint)).not.toContain('https://push.example/1');
  });

  it('삭제된 회원이나 없는 회원으로는 구독할 수 없다 (404)', async () => {
    const service = createService();
    const member = await createMember();
    await prisma.member.update({ where: { id: member.id }, data: { deletedAt: new Date() } });

    await expect(
      service.subscribe({ memberId: member.id, endpoint: 'https://push.example/1', ...keys }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.subscribe({ memberId: 'no-such-member', endpoint: 'https://push.example/2', ...keys }),
    ).rejects.toThrow(NotFoundException);
  });

  it('구독 해지는 endpoint로 지운다', async () => {
    const service = createService();
    const member = await createMember();
    await service.subscribe({ memberId: member.id, endpoint: 'https://push.example/1', ...keys });

    expect(await service.unsubscribe('https://push.example/1')).toEqual({ deleted: 1 });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

describe('deliver', () => {
  it('회원의 모든 기기로 보내고 lastSentAt을 기록한다', async () => {
    const service = createService();
    const member = await createMember();
    await service.subscribe({ memberId: member.id, endpoint: 'https://push.example/phone', ...keys });
    await service.subscribe({ memberId: member.id, endpoint: 'https://push.example/tablet', ...keys });

    const sent = await service.deliver([{ memberId: member.id, payload }]);

    expect(sent).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [, body, options] = sendNotification.mock.calls[0];
    expect(JSON.parse(body as string)).toEqual(payload);
    expect(options).toMatchObject({ TTL: 300, urgency: 'high' });
    const rows = await prisma.pushSubscription.findMany();
    expect(rows.every((r) => r.lastSentAt !== null)).toBe(true);
  });

  it('응답이 410(구독 끊김)이면 그 구독을 지운다', async () => {
    const service = createService();
    const member = await createMember();
    await service.subscribe({ memberId: member.id, endpoint: 'https://push.example/gone', ...keys });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));

    const sent = await service.deliver([{ memberId: member.id, payload }]);

    expect(sent).toBe(0);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('그 밖의 실패(500 등)는 구독을 남겨 둔다 — 일시 장애일 수 있다', async () => {
    const service = createService();
    const member = await createMember();
    await service.subscribe({ memberId: member.id, endpoint: 'https://push.example/1', ...keys });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Server'), { statusCode: 500 }));

    expect(await service.deliver([{ memberId: member.id, payload }])).toBe(0);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('VAPID 키가 없으면 비활성 — 공개키 null, 발송 안 함', async () => {
    const service = createService(false);
    const member = await createMember();
    await prisma.pushSubscription.create({
      data: { memberId: member.id, endpoint: 'https://push.example/1', ...keys },
    });

    expect(service.getPublicKey()).toEqual({ publicKey: null });
    expect(await service.deliver([{ memberId: member.id, payload }])).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('회원 삭제와 구독', () => {
  const members = () => new MembersService(prisma, realtimeStub);

  it('회원을 삭제하면 구독도 지워진다', async () => {
    const member = await createMember();
    await createService().subscribe({ memberId: member.id, endpoint: 'https://push.example/1', ...keys });

    await members().remove(member.id);

    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('익명화해도 구독이 지워진다', async () => {
    const member = await createMember();
    await createService().subscribe({ memberId: member.id, endpoint: 'https://push.example/1', ...keys });

    await members().anonymize(member.id);

    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

describe('게임 알림 문구', () => {
  // 회원 4명 + 출석 + 게임(players) 시드 — 상태·코트·대기 순서를 지정한다
  async function seedGame(opts: { status: 'PLAYING' | 'QUEUED'; courtNo?: number; queueOrder?: number; names: string[]; sessionId?: string }) {
    const sessionId =
      opts.sessionId ?? (await prisma.session.create({ data: { date: new Date('2026-01-01') } })).id;
    const court = opts.courtNo
      ? await prisma.court.create({ data: { sessionId, courtNo: opts.courtNo, status: 'IN_GAME' } })
      : null;
    const attendances = [];
    for (const name of opts.names) {
      const member = await createMember(name);
      attendances.push(await prisma.attendance.create({ data: { sessionId, memberId: member.id } }));
    }
    const game = await prisma.game.create({
      data: {
        sessionId,
        status: opts.status,
        courtId: court?.id ?? null,
        queueOrder: opts.queueOrder ?? null,
        players: { createMany: { data: attendances.map((a) => ({ attendanceId: a.id })) } },
      },
    });
    return { game, attendances, sessionId };
  }

  it('코트 배정 — 4명 각자에게 코트 번호와 본인을 뺀 3명 이름', async () => {
    const { game, attendances } = await seedGame({
      status: 'PLAYING',
      courtNo: 3,
      names: ['김하나', '이두울', '박세엣', '최네엣'],
    });

    const messages = await createService().gameMessages(game.id);

    expect(messages).toHaveLength(4);
    const mine = messages.find((m) => m.memberId === attendances[0].memberId)!;
    expect(mine.payload).toEqual({
      title: '🏸 3번 코트로 오세요',
      body: '함께: 이두울, 박세엣, 최네엣',
      tag: 'letscok-game',
      url: '/m',
    });
  });

  it('대기 조합 — 대기 순번이 실린다 (앞선 조합 수 + 1)', async () => {
    const first = await seedGame({ status: 'QUEUED', queueOrder: 1, names: ['가', '나', '다', '라'] });
    const { game } = await seedGame({
      status: 'QUEUED',
      queueOrder: 2,
      names: ['마', '바', '사', '아'],
      sessionId: first.sessionId,
    });

    const [message] = await createService().gameMessages(game.id);

    expect(message.payload.title).toBe('다음 게임 조합에 들어갔어요');
    expect(message.payload.body.split('\n')[0]).toBe('대기 2번째');
  });

  it('교체 투입 — 지정한 1명에게만', async () => {
    const { game, attendances } = await seedGame({ status: 'PLAYING', courtNo: 1, names: ['가', '나', '다', '라'] });

    const messages = await createService().gameMessages(game.id, attendances[2].id);

    expect(messages.map((m) => m.memberId)).toEqual([attendances[2].memberId]);
  });

  it('이미 끝난 게임이면 보내지 않는다 (발송 전에 종료된 경우)', async () => {
    const { game } = await seedGame({ status: 'PLAYING', courtNo: 1, names: ['가', '나', '다', '라'] });
    await prisma.game.update({ where: { id: game.id }, data: { status: 'FINISHED' } });

    expect(await createService().gameMessages(game.id)).toEqual([]);
  });
});
