-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAt" DATETIME,
    "lastError" TEXT,
    "expiredAt" DATETIME,
    CONSTRAINT "push_subscription_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "push_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "askId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_deviceId_key" ON "push_subscription"("deviceId");

-- CreateIndex
CREATE INDEX "push_outbox_deliveredAt_idx" ON "push_outbox"("deliveredAt");
