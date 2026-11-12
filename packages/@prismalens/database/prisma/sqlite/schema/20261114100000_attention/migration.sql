-- CreateTable
CREATE TABLE "thread_reads" (
    "investigationId" TEXT NOT NULL PRIMARY KEY,
    "generation" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "readAt" DATETIME NOT NULL,
    CONSTRAINT "thread_reads_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "thread_attention" (
    "investigationId" TEXT NOT NULL PRIMARY KEY,
    "lastStatus" TEXT,
    "turnEndedAt" DATETIME,
    "follow" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "thread_attention_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attention_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT,
    "detail" TEXT,
    "resetsAt" DATETIME,
    "ordinal" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "notify" BOOLEAN NOT NULL,
    "silenced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "attention_events_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "attention_events_readAt_createdAt_idx" ON "attention_events"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "attention_events_investigationId_createdAt_idx" ON "attention_events"("investigationId", "createdAt");
