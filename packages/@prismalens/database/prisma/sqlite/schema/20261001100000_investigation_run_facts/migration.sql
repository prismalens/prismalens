-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "harness" TEXT;
ALTER TABLE "investigations" ADD COLUMN "model" TEXT;
ALTER TABLE "investigations" ADD COLUMN "stopRequestedAt" DATETIME;
