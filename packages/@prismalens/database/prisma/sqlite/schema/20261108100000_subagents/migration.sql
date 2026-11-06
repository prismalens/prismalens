-- In-session sub-agents, watched pull requests and requested secrets (#1025, #1024 spec B); additive.
-- CreateTable
CREATE TABLE "subagent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentSessionId" TEXT,
    "title" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "canCancel" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "subagent_sessions_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pr_watches" (
    "prId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "until" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,

    PRIMARY KEY ("prId", "investigationId"),
    CONSTRAINT "pr_watches_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "secrets_requested" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueEnc" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    CONSTRAINT "secrets_requested_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "subagent_sessions_investigationId_sessionId_key" ON "subagent_sessions"("investigationId", "sessionId");

-- CreateIndex
CREATE INDEX "pr_watches_expiresAt_idx" ON "pr_watches"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "secrets_requested_requestId_key" ON "secrets_requested"("requestId");

-- CreateIndex
CREATE INDEX "secrets_requested_investigationId_idx" ON "secrets_requested"("investigationId");

