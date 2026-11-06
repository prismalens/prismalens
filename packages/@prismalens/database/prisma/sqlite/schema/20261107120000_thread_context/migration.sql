-- Thread context (#1024): the PRs a thread found, and the agent's latest plan; additive.
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "agentPlan" TEXT;

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "host" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "state" TEXT NOT NULL DEFAULT 'unknown',
    "review" TEXT NOT NULL DEFAULT 'unknown',
    "checks" TEXT,
    "conflicts" BOOLEAN,
    "detail" TEXT,
    "source" TEXT NOT NULL,
    "etag" TEXT,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pull_requests_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "pull_requests_repositoryId_idx" ON "pull_requests"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_investigationId_url_key" ON "pull_requests"("investigationId", "url");
