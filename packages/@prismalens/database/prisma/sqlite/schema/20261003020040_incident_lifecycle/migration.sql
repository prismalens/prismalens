-- AlterTable
ALTER TABLE "incidents" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "incidents" ADD COLUMN "priorIncidentId" TEXT;
ALTER TABLE "incidents" ADD COLUMN "reopenReason" TEXT;
ALTER TABLE "incidents" ADD COLUMN "reopenedAt" DATETIME;
ALTER TABLE "incidents" ADD COLUMN "timeToClose" INTEGER;

-- CreateIndex
CREATE INDEX "incidents_priorIncidentId_idx" ON "incidents"("priorIncidentId");
