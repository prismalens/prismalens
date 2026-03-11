-- DropIndex
DROP INDEX "connections_integrationId_userId_key";

-- DropIndex
DROP INDEX "integrations_templateId_label_key";

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN "templateVersion" TEXT;

-- CreateIndex
CREATE INDEX "connections_integrationId_userId_idx" ON "connections"("integrationId", "userId");

-- CreateIndex
CREATE INDEX "integrations_templateId_idx" ON "integrations"("templateId");
