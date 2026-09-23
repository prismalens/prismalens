-- AlterTable
ALTER TABLE "pairing_link" ADD COLUMN "scopes" TEXT NOT NULL DEFAULT '["investigate:read","investigate:operate"]';
