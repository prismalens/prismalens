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
    CONSTRAINT "investigations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_investigations" ("accessLevel", "acpSessionId", "agentMode", "awaitingApprovalAt", "completedAt", "configSnapshot", "createdAt", "effort", "endReason", "error", "harness", "harnessThreadId", "id", "incidentId", "kind", "lastTurnOutcome", "liveTurn", "model", "origin", "overlay", "preRun", "report", "rootCause", "rootCauseCategory", "scheduleId", "scheduleRevision", "schemaVersion", "serviceId", "startedAt", "status", "stopRequestedAt", "summary", "tenantId", "title", "triggerReason", "triggerType", "updatedAt", "usage", "workspace") SELECT "accessLevel", "acpSessionId", "agentMode", "awaitingApprovalAt", "completedAt", "configSnapshot", "createdAt", "effort", "endReason", "error", "harness", "harnessThreadId", "id", "incidentId", "kind", "lastTurnOutcome", "liveTurn", "model", "origin", "overlay", "preRun", "report", "rootCause", "rootCauseCategory", "scheduleId", "scheduleRevision", "schemaVersion", "serviceId", "startedAt", "status", "stopRequestedAt", "summary", "tenantId", "title", "triggerReason", "triggerType", "updatedAt", "usage", "workspace" FROM "investigations";
DROP TABLE "investigations";
ALTER TABLE "new_investigations" RENAME TO "investigations";
CREATE UNIQUE INDEX "investigations_harnessThreadId_key" ON "investigations"("harnessThreadId");
CREATE INDEX "investigations_incidentId_idx" ON "investigations"("incidentId");
CREATE INDEX "investigations_scheduleId_createdAt_idx" ON "investigations"("scheduleId", "createdAt");
CREATE INDEX "investigations_serviceId_idx" ON "investigations"("serviceId");
CREATE INDEX "investigations_incidentId_createdAt_idx" ON "investigations"("incidentId", "createdAt");
CREATE INDEX "investigations_status_idx" ON "investigations"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
