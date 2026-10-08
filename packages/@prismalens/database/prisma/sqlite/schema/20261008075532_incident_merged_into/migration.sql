-- Merge incidents (#673 w37): the incident a merged one's alerts moved to.
-- AlterTable
ALTER TABLE "incidents" ADD COLUMN "mergedIntoId" TEXT;

-- CreateIndex
CREATE INDEX "incidents_mergedIntoId_idx" ON "incidents"("mergedIntoId");
