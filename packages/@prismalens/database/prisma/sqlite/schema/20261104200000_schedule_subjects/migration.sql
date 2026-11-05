-- A schedule may be about a project, a service or nothing (#1020); additive, existing rows keep their service.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'service_check',
    "serviceId" TEXT,
    "repositoryId" TEXT,
    "runbook" TEXT,
    "brief" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "model" TEXT,
    "effort" TEXT,
    "accessLevel" TEXT,
    "report" BOOLEAN NOT NULL DEFAULT true,
    "whenAsks" TEXT NOT NULL DEFAULT 'decide',
    "alwaysAllow" TEXT,
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
    CONSTRAINT "schedules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "schedules_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_schedules" ("bindingsHash", "brief", "catchUpMinutes", "consecutiveFailures", "createdAt", "effort", "enabled", "harness", "id", "kind", "lastEvaluatedAt", "missedPolicy", "model", "name", "nextRunAt", "pausedReason", "recurrence", "revision", "runbook", "serviceId", "updatedAt") SELECT "bindingsHash", "brief", "catchUpMinutes", "consecutiveFailures", "createdAt", "effort", "enabled", "harness", "id", "kind", "lastEvaluatedAt", "missedPolicy", "model", "name", "nextRunAt", "pausedReason", "recurrence", "revision", "runbook", "serviceId", "updatedAt" FROM "schedules";
DROP TABLE "schedules";
ALTER TABLE "new_schedules" RENAME TO "schedules";
CREATE INDEX "schedules_enabled_nextRunAt_idx" ON "schedules"("enabled", "nextRunAt");
CREATE INDEX "schedules_repositoryId_idx" ON "schedules"("repositoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
