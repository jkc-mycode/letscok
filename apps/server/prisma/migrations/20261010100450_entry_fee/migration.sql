-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "entryPaidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "entryAccount" TEXT,
ADD COLUMN     "entryFee" INTEGER,
ADD COLUMN     "entryPayeeAttendanceId" TEXT;
