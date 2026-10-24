-- Why a failed run ended: interrupted (restart) or limited (agent usage limit); no backfill.
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "endReason" TEXT;
