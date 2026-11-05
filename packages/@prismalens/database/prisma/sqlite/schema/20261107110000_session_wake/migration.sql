-- Session lifecycle (#1024): when a thread last did anything, a usage limit's reset, and one table of wakes; additive.
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "autoResume" BOOLEAN;
ALTER TABLE "investigations" ADD COLUMN "lastActivityAt" DATETIME;
ALTER TABLE "investigations" ADD COLUMN "limitResetsAt" DATETIME;

-- CreateTable
CREATE TABLE "thread_wakes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" DATETIME,
    CONSTRAINT "thread_wakes_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "thread_wakes_state_at_idx" ON "thread_wakes"("state", "at");

-- CreateIndex
CREATE INDEX "thread_wakes_investigationId_kind_state_idx" ON "thread_wakes"("investigationId", "kind", "state");
