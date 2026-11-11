-- Thread jobs: automatic PR status, cron jobs and the settle teardown (#1024 surface F).
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "autoPause" TEXT;
ALTER TABLE "investigations" ADD COLUMN "endedNote" TEXT;
ALTER TABLE "investigations" ADD COLUMN "teardownAt" DATETIME;

-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN "headSha" TEXT;

-- CreateTable
CREATE TABLE "pr_polls" (
    "url" TEXT NOT NULL PRIMARY KEY,
    "headSha" TEXT,
    "etag" TEXT,
    "nextPollAt" DATETIME NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "pr_feed" (
    "prId" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'watching',
    "reason" TEXT,
    "cursor" TEXT,
    "pending" TEXT,
    "since" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" DATETIME,
    "guardFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pr_feed_prId_fkey" FOREIGN KEY ("prId") REFERENCES "pull_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pr_feed_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cron_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "nextAt" DATETIME,
    "expiresAt" DATETIME,
    "lastFiredAt" DATETIME,
    "pendingSince" DATETIME,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cron_jobs_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "pr_polls_nextPollAt_idx" ON "pr_polls"("nextPollAt");

-- CreateIndex
CREATE INDEX "pr_feed_investigationId_idx" ON "pr_feed"("investigationId");

-- CreateIndex
CREATE INDEX "cron_jobs_investigationId_idx" ON "cron_jobs"("investigationId");

-- CreateIndex
CREATE INDEX "cron_jobs_nextAt_idx" ON "cron_jobs"("nextAt");

