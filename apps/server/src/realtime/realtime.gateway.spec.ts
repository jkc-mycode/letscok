import type { Socket } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';

// 실제 소켓 없이 방 목록만 흉내 낸다
function fakeClient() {
  const rooms = new Set(['socket-id']);
  return {
    id: 'socket-id',
    rooms,
    join: (room: string) => rooms.add(room),
    leave: (room: string) => rooms.delete(room),
  } as unknown as Socket & { rooms: Set<string> };
}

describe('session.join 입력 검사', () => {
  const gateway = new RealtimeGateway();

  it.each([[undefined], [{}], [{ sessionId: '' }], [{ sessionId: 123 }], [{ sessionId: ['a'] }], [{ sessionId: 'x'.repeat(65) }]])(
    '올바르지 않은 값 %j 은 방에 들어가지 못한다',
    (payload) => {
      const client = fakeClient();
      expect(gateway.handleJoinSession(client, payload as never)).toEqual({ success: false });
      expect(client.rooms.size).toBe(1);
    },
  );

  it('모임 번호 문자열이면 들어간다', () => {
    const client = fakeClient();
    expect(gateway.handleJoinSession(client, { sessionId: 'abc' })).toEqual({ success: true });
    expect(client.rooms.has('session:abc')).toBe(true);
  });

  it('방이 5개를 넘으면 가장 오래된 방에서 나온다', () => {
    const client = fakeClient();
    for (let i = 1; i <= 6; i++) gateway.handleJoinSession(client, { sessionId: `s${i}` });

    expect(client.rooms.size).toBe(6); // 자기 방 + 모임 방 5개
    expect(client.rooms.has('session:s1')).toBe(false);
    expect(client.rooms.has('session:s6')).toBe(true);
  });
});
