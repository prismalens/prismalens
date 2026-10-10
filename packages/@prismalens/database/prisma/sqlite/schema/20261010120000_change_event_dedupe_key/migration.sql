-- What changed (#811): change events read from the git host, one row per host, repo, commit and service.
-- AlterTable
ALTER TABLE "change_events" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "change_events_dedupeKey_key" ON "change_events"("dedupeKey");
