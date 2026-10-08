-- A thread's live turn and how its last message ended (#673 w59).
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "liveTurn" TEXT;
ALTER TABLE "investigations" ADD COLUMN "lastTurnOutcome" TEXT;
