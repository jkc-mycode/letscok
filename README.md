# 렛츠콕 (letscok) 🏸

배드민턴 소모임의 **보드+자석 게임 배정**을 디지털화한 실시간 코트 관리 서비스.
운영진은 태블릿 관제판에서 4명씩 코트에 배정하고, 모임원은 폰에서 자기 차례를 실시간으로 확인한다.

## 흐름

```
셔틀콕 제출 → 현장 QR 스캔 → 이름으로 체크인
                                   ↓
운영진 관제판: 대기 인원에서 4명 조합 → 코트 배정 → 게임 종료
                                   ↓
모임원 폰(/m): 내 대기 순번·게임 중·경과 시간 실시간 확인
```

## 화면

| 경로 | 대상 | 설명 |
|------|------|------|
| `/admin` | 운영진(태블릿) | 코트 관제판 — 3구역(게임 중 / 대기 조합 / 대기 인원), 패스코드 인증 |
| `/checkin` | 모임원(폰) | 이름 검색 체크인 · 신규 등록 |
| `/m` | 모임원(폰) | 내 상태 — 관제판과 같은 보드의 읽기 전용 |

## 주요 기능

- **실시간 보드** — 모든 변경을 전체 스냅샷으로 브로드캐스트(Socket.IO). 재연결 시 REST 재조회로 복구
- **동적 QR 체크인 코드** — 세션마다 6자리 코드 발급, 관제판 [체크인 QR] 모달로 현장 표시. 코드 없는 URL 재사용(원격 체크인)은 차단
- **게임 추천** — 공정성(대기시간·게임 수) + 다양성(오늘 함께 뛴 조합 회피) + 성별 복식 구성을 점수화해 후보 조합 제안. 넣을지는 운영진 재량
- **성별 복식 구성** — 회원 성별(♂/♀)로 남복·여복·혼복 판정, 3:1 어정쩡한 구성은 소프트 회피
- **중복 대기** — 잔여 인원(4로 안 나눠질 때)을 게임 중인 사람과 미리 조합
- **운영진 인증** — 공유 패스코드(localStorage 유지). 모임 종료 시 자동 로그아웃

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 백엔드 | NestJS 11 · Prisma 7 · PostgreSQL · Socket.IO 4 |
| 프론트 | Next.js 15 (App Router) · React 19 · Tailwind 4 · motion · qrcode.react |
| 공유 | `@letscok/shared-types` (enum · `I*` 인터페이스, zero-dep) |
| 관측 | Sentry (에러만, 선택) |

## 구조

```
apps/server            NestJS + Prisma + Socket.IO (백엔드)
apps/web               Next.js App Router (운영진 태블릿 + 모임원 모바일)
packages/shared-types  공유 타입 (enum, I* 인터페이스)
```

## 개발 환경 준비

```bash
pnpm install                                 # shared-types는 prepare 훅으로 자동 빌드됨
cp apps/server/.env.example apps/server/.env # DATABASE_URL / ADMIN_PASSCODE / CORS_ORIGINS
cp apps/web/.env.example apps/web/.env.local # NEXT_PUBLIC_API_URL

pnpm --filter @letscok/server exec prisma migrate dev   # DB 마이그레이션 + 클라이언트 생성
```

> Prisma 7은 스키마의 `url`을 쓰지 않는다 — CLI 연결은 `apps/server/prisma.config.ts`가 담당.
> 스키마 변경 후 컴파일 에러가 나면 `prisma generate` 재실행.

## 실행 (터미널 분리)

```bash
pnpm dev:server   # http://localhost:4000  (GET /health 확인)
pnpm dev:web      # http://localhost:3001
```

## 배포

| 구성 | 서비스 |
|------|--------|
| Frontend | Vercel (루트 디렉터리 `apps/web`) |
| Backend | Render Free Web Service (레포 루트 · 모노레포 설치) |
| DB | Neon Free (Postgres, 런타임=Pooled / 마이그레이션=Direct) |
| 웜업 | cron-job.org — 매일 07~23시 KST 10분 간격 `GET /health` (Render 슬립 방지) |

상세 절차·트러블슈팅은 `docs/deploy-guide.md`, 설계·현황은 `docs/active/letscok-mvp-plan.md`
(둘 다 git 미포함 위키).
