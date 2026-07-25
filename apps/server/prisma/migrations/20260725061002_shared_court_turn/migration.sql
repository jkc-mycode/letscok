-- AlterTable
ALTER TABLE "courts" ADD COLUMN     "isShared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ourTurn" BOOLEAN NOT NULL DEFAULT true;
