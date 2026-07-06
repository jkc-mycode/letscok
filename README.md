# 렛츠콕 (letscok)

배드민턴 소모임 인원·코트 관리 서비스. 보드+자석 방식의 게임 배정을 태블릿(운영진)과 모바일(모임원)로 디지털화한다.

## 구조

```
apps/server           NestJS + Prisma + Socket.IO (백엔드)
apps/web              Next.js App Router (운영진 태블릿 + 모임원 모바일)
packages/shared-types 공유 타입 (enum, I* 인터페이스)
```

## 개발 환경 준비

```bash
pnpm install                                 # shared-types는 prepare 훅으로 자동 빌드됨
cp apps/server/.env.example apps/server/.env # DATABASE_URL 등 채우기
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @letscok/server exec prisma migrate dev   # DB 마이그레이션 + 클라이언트 생성
```

## 실행 (터미널 분리)

```bash
pnpm dev:server   # http://localhost:4000 (GET /health 확인)
pnpm dev:web      # http://localhost:3000
```

## 배포

| 구성 | 서비스 |
|------|--------|
| Frontend | Vercel (루트 디렉터리 `apps/web`) |
| Backend | Render Free Web Service (루트 디렉터리 `apps/server`) |
| DB | Neon Free (Postgres) |
| 웜업 | cron-job.org — 매일 19~23시 KST 10분 간격 `GET /health` |

상세 계획: `docs/plan/letscok-mvp-plan.md` (git 미포함 위키)
