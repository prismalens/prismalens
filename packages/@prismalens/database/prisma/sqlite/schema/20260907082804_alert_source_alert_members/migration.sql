-- CreateTable
CREATE TABLE "alert_source_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "sourceAlertId" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "alert_source_alerts_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "alert_source_alerts_sourceAlertId_idx" ON "alert_source_alerts"("sourceAlertId");

-- CreateIndex
CREATE INDEX "alert_source_alerts_alertId_resolvedAt_idx" ON "alert_source_alerts"("alertId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "alert_source_alerts_alertId_sourceAlertId_key" ON "alert_source_alerts"("alertId", "sourceAlertId");
