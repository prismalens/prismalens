-- A run's permission level as asked (#673 w21 ruling 2026-10-10); no backfill.
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "accessLevel" TEXT;
