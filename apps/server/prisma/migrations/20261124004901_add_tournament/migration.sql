-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TournamentTeam" AS ENUM ('BLUE', 'WHITE');

-- CreateEnum
CREATE TYPE "TournamentMatchType" AS ENUM ('MENS', 'WOMENS', 'MIXED');

-- CreateEnum
CREATE TYPE "TournamentMatchStatus" AS ENUM ('QUEUED', 'PLAYING', 'FINISHED');

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "entryCode" TEXT NOT NULL,
    "courtCount" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "team" "TournamentTeam" NOT NULL,
    "enteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_matches" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "matchNo" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "courtNo" INTEGER NOT NULL,
    "type" "TournamentMatchType" NOT NULL,
    "status" "TournamentMatchStatus" NOT NULL DEFAULT 'QUEUED',
    "queueOrder" INTEGER NOT NULL,
    "blueScore" INTEGER,
    "whiteScore" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "tournament_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_match_players" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "proxyMemberId" TEXT,

    CONSTRAINT "tournament_match_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournaments_status_idx" ON "tournaments"("status");

-- CreateIndex
CREATE INDEX "tournament_participants_memberId_idx" ON "tournament_participants"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_tournamentId_memberId_key" ON "tournament_participants"("tournamentId", "memberId");

-- CreateIndex
CREATE INDEX "tournament_matches_tournamentId_status_idx" ON "tournament_matches"("tournamentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_matches_tournamentId_matchNo_key" ON "tournament_matches"("tournamentId", "matchNo");

-- CreateIndex
CREATE INDEX "tournament_match_players_participantId_idx" ON "tournament_match_players"("participantId");

-- CreateIndex
CREATE INDEX "tournament_match_players_proxyMemberId_idx" ON "tournament_match_players"("proxyMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_match_players_matchId_slot_key" ON "tournament_match_players"("matchId", "slot");

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_match_players" ADD CONSTRAINT "tournament_match_players_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "tournament_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_match_players" ADD CONSTRAINT "tournament_match_players_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "tournament_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_match_players" ADD CONSTRAINT "tournament_match_players_proxyMemberId_fkey" FOREIGN KEY ("proxyMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
