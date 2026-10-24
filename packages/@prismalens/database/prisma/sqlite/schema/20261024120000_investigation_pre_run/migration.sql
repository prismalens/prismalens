-- Pre-run snapshot a follow-up and the report read again; when a connection last passed Test (#848).
ALTER TABLE "investigations" ADD COLUMN "preRun" TEXT;
ALTER TABLE "connections" ADD COLUMN "testedAt" DATETIME;
