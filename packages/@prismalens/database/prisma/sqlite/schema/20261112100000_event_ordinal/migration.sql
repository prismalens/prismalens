-- Event record positions (#1101 - Wave 2: thread UX hill climb, round 2, category 12).
-- `ordinal` is the commit order of a thread's events: a resume cursor reads `ordinal > n`.
-- A trigger stamps it so every writer gets one; SQLite's single writer keeps the committed set a prefix.
ALTER TABLE "investigations" ADD COLUMN "eventOrdinal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "investigations" ADD COLUMN "eventGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "investigation_events" ADD COLUMN "ordinal" INTEGER NOT NULL DEFAULT 0;

UPDATE "investigation_events" SET "ordinal" = r."n"
FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "investigationId" ORDER BY "seq", "branchId") AS "n"
    FROM "investigation_events"
) AS r
WHERE "investigation_events"."id" = r."id";

UPDATE "investigations" SET "eventOrdinal" = (
    SELECT COALESCE(MAX("ordinal"), 0) FROM "investigation_events" e WHERE e."investigationId" = "investigations"."id"
);

CREATE INDEX "investigation_events_investigationId_ordinal_idx" ON "investigation_events"("investigationId", "ordinal");

CREATE TRIGGER "investigation_events_ordinal" AFTER INSERT ON "investigation_events"
BEGIN
    UPDATE "investigations" SET "eventOrdinal" = "eventOrdinal" + 1 WHERE "id" = NEW."investigationId";
    UPDATE "investigation_events" SET "ordinal" = (
        SELECT "eventOrdinal" FROM "investigations" WHERE "id" = NEW."investigationId"
    ) WHERE "id" = NEW."id";
END;
