-- CreateTable
CREATE TABLE "pairing_link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME
);

-- CreateTable
CREATE TABLE "device_session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    "pairingLinkId" TEXT NOT NULL,
    CONSTRAINT "device_session_pairingLinkId_fkey" FOREIGN KEY ("pairingLinkId") REFERENCES "pairing_link" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "pairing_link_tokenHash_key" ON "pairing_link"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_session_tokenHash_key" ON "device_session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_session_pairingLinkId_key" ON "device_session"("pairingLinkId");
