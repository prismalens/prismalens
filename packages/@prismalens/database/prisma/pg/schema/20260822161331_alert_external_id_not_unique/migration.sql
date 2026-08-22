-- DropIndex
DROP INDEX "alerts_externalId_key";

-- CreateIndex
CREATE INDEX "alerts_externalId_idx" ON "alerts"("externalId");
