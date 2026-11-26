/*
  Warnings:

  - A unique constraint covering the columns `[tournamentId,raffleNo]` on the table `tournament_participants` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tournament_participants" ADD COLUMN     "raffleNo" INTEGER;

-- CreateTable
CREATE TABLE "tournament_prizes" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "raffleNo" INTEGER,
    "participantId" TEXT,
    "drawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournament_prizes_tournamentId_idx" ON "tournament_prizes"("tournamentId");

-- CreateIndex
CREATE INDEX "tournament_prizes_participantId_idx" ON "tournament_prizes"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_tournamentId_raffleNo_key" ON "tournament_participants"("tournamentId", "raffleNo");

-- AddForeignKey
ALTER TABLE "tournament_prizes" ADD CONSTRAINT "tournament_prizes_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_prizes" ADD CONSTRAINT "tournament_prizes_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "tournament_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
