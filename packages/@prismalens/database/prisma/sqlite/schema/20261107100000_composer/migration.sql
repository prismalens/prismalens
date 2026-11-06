-- Composer drafts, reference frecency, PrismaLens tools' asks and the agent's advertised commands (#1024); additive.
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "agentCommands" TEXT;

-- CreateTable
CREATE TABLE "composer_drafts" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "reference_uses" (
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME NOT NULL,

    PRIMARY KEY ("kind", "key")
);

-- CreateIndex
CREATE INDEX "composer_drafts_updatedAt_idx" ON "composer_drafts"("updatedAt");

-- CreateTable
CREATE TABLE "tool_asks" (
    "askId" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "ask" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "outcome" TEXT,
    "answer" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "tool_asks_threadId_status_idx" ON "tool_asks"("threadId", "status");
