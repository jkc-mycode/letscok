-- CreateTable
CREATE TABLE "member_aliases" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_aliases_alias_key" ON "member_aliases"("alias");

-- CreateIndex
CREATE INDEX "member_aliases_memberId_idx" ON "member_aliases"("memberId");

-- AddForeignKey
ALTER TABLE "member_aliases" ADD CONSTRAINT "member_aliases_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
