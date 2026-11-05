-- A project may be a folder inside a repository, or a plain folder with no git (#1020).
ALTER TABLE "repositories" ADD COLUMN "subPath" TEXT;
ALTER TABLE "repositories" ADD COLUMN "plain" BOOLEAN NOT NULL DEFAULT false;
