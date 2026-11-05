-- A project's logo, found in its own files or its host's owner avatar, cached per repository (#1024).
-- AlterTable
ALTER TABLE "repositories" ADD COLUMN "iconCheckedAt" DATETIME;
ALTER TABLE "repositories" ADD COLUMN "iconKey" TEXT;
