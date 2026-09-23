-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "integrationId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "connectionConfigEnc" BLOB,
    "credentialsEnc" BLOB NOT NULL,
    "tokenExpiresAt" DATETIME,
    "tokenType" TEXT,
    "grantedScopes" TEXT NOT NULL DEFAULT '[]',
    "metadataEnc" BLOB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" DATETIME,
    "lastRefreshedAt" DATETIME,
    "lastErrorMessage" TEXT,
    "lastErrorAt" DATETIME,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connections_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_connections" ("connectionConfigEnc", "consecutiveErrors", "createdAt", "credentialsEnc", "grantedScopes", "id", "integrationId", "label", "lastErrorAt", "lastErrorMessage", "lastRefreshedAt", "lastUsedAt", "metadataEnc", "status", "tenantId", "tokenExpiresAt", "tokenType", "updatedAt", "userId") SELECT "connectionConfigEnc", "consecutiveErrors", "createdAt", "credentialsEnc", "grantedScopes", "id", "integrationId", "label", "lastErrorAt", "lastErrorMessage", "lastRefreshedAt", "lastUsedAt", "metadataEnc", "status", "tenantId", "tokenExpiresAt", "tokenType", "updatedAt", "userId" FROM "connections";
DROP TABLE "connections";
ALTER TABLE "new_connections" RENAME TO "connections";
CREATE INDEX "connections_integrationId_userId_idx" ON "connections"("integrationId", "userId");
CREATE INDEX "connections_userId_idx" ON "connections"("userId");
CREATE INDEX "connections_status_idx" ON "connections"("status");
CREATE INDEX "connections_tokenExpiresAt_idx" ON "connections"("tokenExpiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
