-- A run is a thread (#673): its kind, the agent's own mode asked for, and a title.
-- AlterTable
ALTER TABLE "investigations" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'investigation';
ALTER TABLE "investigations" ADD COLUMN "agentMode" TEXT;
ALTER TABLE "investigations" ADD COLUMN "title" TEXT;

-- CreateIndex
CREATE INDEX "investigations_incidentId_createdAt_idx" ON "investigations"("incidentId", "createdAt");
