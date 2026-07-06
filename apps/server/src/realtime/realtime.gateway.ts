import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  IJoinSessionPayload,
  ISessionSnapshot,
  SocketClientEvents,
  SocketEvents,
} from '@letscok/shared-types';
import { Server, Socket } from 'socket.io';

// 세션별 룸 이름 — 운영진/모임원 구분 없이 한 룸 사용
// (모든 이벤트가 양쪽에 동일하게 필요하고 민감 데이터도 없어 룸을 나눌 이유가 없음)
function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

@WebSocketGateway({
  // REST와 달리 게이트웨이 데코레이터는 부팅 초기에 평가되므로 main.ts 최상단의
  // dotenv 로드에 의존한다 (CORS_ORIGINS 미설정 시 로컬 웹만 허용)
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  },
})
export class RealtimeGateway {
  @WebSocketServer()
  server: Server;

  // 클라이언트는 접속 후 스냅샷의 sessionId로 룸에 입장한다
  // (룸 입장 전 놓친 변경은 REST 스냅샷 재조회로 복구하는 설계라 유실 걱정 없음)
  @SubscribeMessage(SocketClientEvents.JOIN_SESSION)
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: IJoinSessionPayload,
  ): { success: boolean } {
    if (!payload?.sessionId) {
      return { success: false };
    }
    void client.join(sessionRoom(payload.sessionId));
    return { success: true };
  }

  emitSnapshotUpdated(sessionId: string, snapshot: ISessionSnapshot): void {
    this.server
      .to(sessionRoom(sessionId))
      .emit(SocketEvents.SNAPSHOT_UPDATED, snapshot);
  }

  emitSessionClosed(sessionId: string): void {
    this.server
      .to(sessionRoom(sessionId))
      .emit(SocketEvents.SESSION_CLOSED, { sessionId });
  }
}
