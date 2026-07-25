-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('LEADER', 'MANAGER', 'MEMBER');

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "role" "MemberRole" NOT NULL DEFAULT 'MEMBER';
