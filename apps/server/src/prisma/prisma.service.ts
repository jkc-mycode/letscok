import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// 앱 전체에서 유일한 DB 연결 창구 — 기능 서비스들은 이 클래스를 주입받아 this.prisma가 아닌
// 자기 자신처럼 (예: prisma.member.findMany) 사용한다
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Prisma 7: 스키마의 url이 사라지고 드라이버 어댑터를 생성자에 직접 전달하는 방식
    // 이 시점엔 연결 설정만 준비되고 실제 접속은 아직 일어나지 않는다
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL as string,
      }),
    });
  }

  // 부팅 시 명시적으로 연결 — 생략해도 첫 쿼리 때 lazy connect 되지만,
  // 그러면 DB 장애를 첫 요청에서야 발견하므로 부팅 = 연결 검증이 되도록 한다
  async onModuleInit() {
    await this.$connect();
  }

  // 종료 시 커넥션 풀 정리 (Render 재배포 등 graceful shutdown 대응)
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
