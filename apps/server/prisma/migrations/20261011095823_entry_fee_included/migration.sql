-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "entryIncluded" BOOLEAN NOT NULL DEFAULT false;

-- 이미 입장비를 정해 둔 모임은 예전처럼 출석자 전원이 목록에 남게
UPDATE "attendances" a SET "entryIncluded" = true
FROM "sessions" s
WHERE a."sessionId" = s.id
  AND (s."entryFee" IS NOT NULL OR s."entryAccount" IS NOT NULL OR s."entryPayeeAttendanceId" IS NOT NULL);
