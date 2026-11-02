-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'service_check',
    "serviceId" TEXT NOT NULL,
    "runbook" TEXT,
    "brief" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "model" TEXT,
    "effort" TEXT,
    "missedPolicy" TEXT NOT NULL DEFAULT 'run_once',
    "catchUpMinutes" INTEGER NOT NULL DEFAULT 360,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedReason" TEXT,
    "bindingsHash" TEXT NOT NULL,
    "nextRunAt" DATETIME,
    "lastEvaluatedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "schedules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedule_ticks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "missedCount" INTEGER NOT NULL DEFAULT 0,
    "missedOverflow" BOOLEAN NOT NULL DEFAULT false,
    "investigationId" TEXT,
    "revision" INTEGER NOT NULL,
    CONSTRAINT "schedule_ticks_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedule_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "deviceId" TEXT,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_investigations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "incidentId" TEXT,
    "serviceId" TEXT,
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
    "accessLevel" TEXT,
    "liveTurn" TEXT,
    "lastTurnOutcome" TEXT,
    "endReason" TEXT,
    "preRun" TEXT,
    "awaitingApprovalAt" DATETIME,
    CONSTRAINT "investigations_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "investigations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_investigations" ("accessLevel", "acpSessionId", "agentMode", "awaitingApprovalAt", "completedAt", "createdAt", "effort", "endReason", "error", "harness", "harnessThreadId", "id", "incidentId", "kind", "lastTurnOutcome", "liveTurn", "model", "origin", "overlay", "preRun", "report", "rootCause", "rootCauseCategory", "schemaVersion", "startedAt", "status", "stopRequestedAt", "summary", "tenantId", "title", "triggerReason", "triggerType", "updatedAt", "usage", "workspace") SELECT "accessLevel", "acpSessionId", "agentMode", "awaitingApprovalAt", "completedAt", "createdAt", "effort", "endReason", "error", "harness", "harnessThreadId", "id", "incidentId", "kind", "lastTurnOutcome", "liveTurn", "model", "origin", "overlay", "preRun", "report", "rootCause", "rootCauseCategory", "schemaVersion", "startedAt", "status", "stopRequestedAt", "summary", "tenantId", "title", "triggerReason", "triggerType", "updatedAt", "usage", "workspace" FROM "investigations";
DROP TABLE "investigations";
ALTER TABLE "new_investigations" RENAME TO "investigations";
CREATE UNIQUE INDEX "investigations_harnessThreadId_key" ON "investigations"("harnessThreadId");
CREATE INDEX "investigations_incidentId_idx" ON "investigations"("incidentId");
CREATE INDEX "investigations_scheduleId_createdAt_idx" ON "investigations"("scheduleId", "createdAt");
CREATE INDEX "investigations_serviceId_idx" ON "investigations"("serviceId");
CREATE INDEX "investigations_incidentId_createdAt_idx" ON "investigations"("incidentId", "createdAt");
CREATE INDEX "investigations_status_idx" ON "investigations"("status");
CREATE TABLE "new_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'investigation',
    "investigationId" TEXT NOT NULL,
    "incidentId" TEXT,
    "payload" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedBy" TEXT,
    "claimedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "startBy" DATETIME,
    "finishedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_jobs" ("attempts", "claimedAt", "claimedBy", "createdAt", "finishedAt", "heartbeatAt", "id", "incidentId", "investigationId", "kind", "lastError", "maxAttempts", "payload", "priority", "runAt", "status", "tenantId", "updatedAt") SELECT "attempts", "claimedAt", "claimedBy", "createdAt", "finishedAt", "heartbeatAt", "id", "incidentId", "investigationId", "kind", "lastError", "maxAttempts", "payload", "priority", "runAt", "status", "tenantId", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
CREATE UNIQUE INDEX "jobs_investigationId_key" ON "jobs"("investigationId");
CREATE INDEX "jobs_status_runAt_priority_idx" ON "jobs"("status", "runAt", "priority");
CREATE INDEX "jobs_status_heartbeatAt_idx" ON "jobs"("status", "heartbeatAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "schedules_enabled_nextRunAt_idx" ON "schedules"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "schedule_ticks_scheduleId_decidedAt_idx" ON "schedule_ticks"("scheduleId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_ticks_scheduleId_scheduledFor_key" ON "schedule_ticks"("scheduleId", "scheduledFor");

-- CreateIndex
CREATE INDEX "schedule_events_scheduleId_createdAt_idx" ON "schedule_events"("scheduleId", "createdAt");
