-- CreateTable
CREATE TABLE "turn_inputs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "parts" TEXT NOT NULL,
    "chars" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "turn_inputs_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "turn_inputs_investigationId_seq_idx" ON "turn_inputs"("investigationId", "seq");
