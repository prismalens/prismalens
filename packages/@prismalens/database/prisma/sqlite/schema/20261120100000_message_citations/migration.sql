-- Messages cited across threads (#1195); additive.
-- CreateTable
CREATE TABLE "message_citations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "sourceThreadId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceTurn" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_citations_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_citations_sourceThreadId_fkey" FOREIGN KEY ("sourceThreadId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "message_citations_sourceThreadId_idx" ON "message_citations"("sourceThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "message_citations_threadId_sourceThreadId_sourceKey_key" ON "message_citations"("threadId", "sourceThreadId", "sourceKey");
