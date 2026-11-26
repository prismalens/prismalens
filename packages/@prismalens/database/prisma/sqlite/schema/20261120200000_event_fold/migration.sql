-- A rewind folds later events instead of deleting them (#1193); additive.
-- AlterTable
ALTER TABLE "investigation_events" ADD COLUMN "foldedBy" TEXT;

-- CreateIndex
CREATE INDEX "investigation_events_investigationId_foldedBy_idx" ON "investigation_events"("investigationId", "foldedBy");
