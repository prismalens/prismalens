-- A thread may work in the user's own checkout, one at a time (#1024).
-- AlterTable
ALTER TABLE "repositories" ADD COLUMN "workIn" TEXT;

-- CreateTable
CREATE TABLE "checkout_leases" (
    "canonicalPath" TEXT NOT NULL PRIMARY KEY,
    "generation" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checkout_leases_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "checkout_leases_investigationId_idx" ON "checkout_leases"("investigationId");
