-- CreateTable
CREATE TABLE "alert_source_alerts" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "sourceAlertId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "alert_source_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_source_alerts_sourceAlertId_idx" ON "alert_source_alerts"("sourceAlertId");

-- CreateIndex
CREATE INDEX "alert_source_alerts_alertId_resolvedAt_idx" ON "alert_source_alerts"("alertId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "alert_source_alerts_alertId_sourceAlertId_key" ON "alert_source_alerts"("alertId", "sourceAlertId");

-- AddForeignKey
ALTER TABLE "alert_source_alerts" ADD CONSTRAINT "alert_source_alerts_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
