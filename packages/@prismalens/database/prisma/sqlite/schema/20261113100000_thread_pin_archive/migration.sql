-- Pinned and archived threads (#1101 category 20): pinned list first, archived leave the list.
ALTER TABLE "investigations" ADD COLUMN "pinnedAt" DATETIME;
ALTER TABLE "investigations" ADD COLUMN "archivedAt" DATETIME;
