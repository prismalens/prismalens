-- Events a run could not store (#1101 category 12): a reader is told the record is incomplete.
ALTER TABLE "investigations" ADD COLUMN "eventsLost" INTEGER NOT NULL DEFAULT 0;
