-- Threads that start threads (#1024 spec F): tree columns on investigations, and the tree's messages, waits, proposals, pending actions and allowances; additive.
-- CreateTable
CREATE TABLE "thread_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rootId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'queue',
    "state" TEXT NOT NULL DEFAULT 'queued',
    "requestId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    CONSTRAINT "thread_messages_toId_fkey" FOREIGN KEY ("toId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "thread_waits" (
    "waiterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'any',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("waiterId", "targetId"),
    CONSTRAINT "thread_waits_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "outcome" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "proposals_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "askId" TEXT,
    "callerId" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "executedAt" DATETIME,
    "deliveredAt" DATETIME,
    CONSTRAINT "pending_actions_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tree_allowances" (
    "rootId" TEXT NOT NULL PRIMARY KEY,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT NOT NULL,
    CONSTRAINT "tree_allowances_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_investigations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "incidentId" TEXT,
    "serviceId" TEXT,
    "repositoryId" TEXT,
    "scheduleId" TEXT,
    "scheduleRevision" INTEGER,
    "configSnapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "summary" TEXT,
    "rootCause" TEXT,
    "rootCauseCategory" TEXT,
    "report" TEXT,
    "overlay" TEXT,
    "error" TEXT,
    "harnessThreadId" TEXT,
    "harness" TEXT,
    "model" TEXT,
    "effort" TEXT,
    "usage" TEXT,
    "stopRequestedAt" DATETIME,
    "acpSessionId" TEXT,
    "workspace" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'local',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "triggerType" TEXT,
    "triggerReason" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'investigation',
    "agentMode" TEXT,
    "title" TEXT,
    "titleSetBy" TEXT,
    "helperPlace" TEXT,
    "accessLevel" TEXT,
    "liveTurn" TEXT,
    "lastTurnOutcome" TEXT,
    "endReason" TEXT,
    "preRun" TEXT,
    "awaitingApprovalAt" DATETIME,
    "agentCommands" TEXT,
    "lastVisitedAt" DATETIME,
    "settledAt" DATETIME,
    "lastActivityAt" DATETIME,
    "limitResetsAt" DATETIME,
    "autoResume" BOOLEAN,
    "agentPlan" TEXT,
    "parentId" TEXT,
    "rootId" TEXT,
    "role" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "investigations_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "investigations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "investigations_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "investigations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "investigations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_investigations" ("accessLevel", "acpSessionId", "agentCommands", "agentMode", "agentPlan", "autoResume", "awaitingApprovalAt", "completedAt", "configSnapshot", "createdAt", "effort", "endReason", "error", "harness", "harnessThreadId", "helperPlace", "id", "incidentId", "kind", "lastActivityAt", "lastTurnOutcome", "lastVisitedAt", "limitResetsAt", "liveTurn", "model", "origin", "overlay", "preRun", "report", "repositoryId", "rootCause", "rootCauseCategory", "scheduleId", "scheduleRevision", "schemaVersion", "serviceId", "settledAt", "startedAt", "status", "stopRequestedAt", "summary", "tenantId", "title", "titleSetBy", "triggerReason", "triggerType", "updatedAt", "usage", "workspace") SELECT "accessLevel", "acpSessionId", "agentCommands", "agentMode", "agentPlan", "autoResume", "awaitingApprovalAt", "completedAt", "configSnapshot", "createdAt", "effort", "endReason", "error", "harness", "harnessThreadId", "helperPlace", "id", "incidentId", "kind", "lastActivityAt", "lastTurnOutcome", "lastVisitedAt", "limitResetsAt", "liveTurn", "model", "origin", "overlay", "preRun", "report", "repositoryId", "rootCause", "rootCauseCategory", "scheduleId", "scheduleRevision", "schemaVersion", "serviceId", "settledAt", "startedAt", "status", "stopRequestedAt", "summary", "tenantId", "title", "titleSetBy", "triggerReason", "triggerType", "updatedAt", "usage", "workspace" FROM "investigations";
DROP TABLE "investigations";
ALTER TABLE "new_investigations" RENAME TO "investigations";
CREATE UNIQUE INDEX "investigations_harnessThreadId_key" ON "investigations"("harnessThreadId");
CREATE INDEX "investigations_rootId_idx" ON "investigations"("rootId");
CREATE INDEX "investigations_parentId_idx" ON "investigations"("parentId");
CREATE INDEX "investigations_incidentId_idx" ON "investigations"("incidentId");
CREATE INDEX "investigations_scheduleId_createdAt_idx" ON "investigations"("scheduleId", "createdAt");
CREATE INDEX "investigations_serviceId_idx" ON "investigations"("serviceId");
CREATE INDEX "investigations_repositoryId_createdAt_idx" ON "investigations"("repositoryId", "createdAt");
CREATE INDEX "investigations_incidentId_createdAt_idx" ON "investigations"("incidentId", "createdAt");
CREATE INDEX "investigations_status_idx" ON "investigations"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "thread_messages_toId_state_idx" ON "thread_messages"("toId", "state");

-- CreateIndex
CREATE INDEX "thread_messages_rootId_idx" ON "thread_messages"("rootId");

-- CreateIndex
CREATE UNIQUE INDEX "thread_messages_fromId_requestId_key" ON "thread_messages"("fromId", "requestId");

-- CreateIndex
CREATE INDEX "proposals_threadId_idx" ON "proposals"("threadId");

-- CreateIndex
CREATE INDEX "pending_actions_state_idx" ON "pending_actions"("state");

-- CreateIndex
CREATE INDEX "pending_actions_askId_idx" ON "pending_actions"("askId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_actions_callerId_requestId_key" ON "pending_actions"("callerId", "requestId");
