-- DropIndex
DROP INDEX "alerts_dedupKey_key";

-- CreateIndex
CREATE INDEX "alerts_dedupKey_idx" ON "alerts"("dedupKey");
