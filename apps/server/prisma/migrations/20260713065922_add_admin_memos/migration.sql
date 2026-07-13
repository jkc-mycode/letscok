-- CreateTable
CREATE TABLE "admin_memos" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_memos_pkey" PRIMARY KEY ("id")
);
