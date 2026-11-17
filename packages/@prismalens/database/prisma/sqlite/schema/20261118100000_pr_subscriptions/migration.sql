-- AlterTable
ALTER TABLE "pr_polls" ADD COLUMN "cursor" TEXT;

-- CreateTable
CREATE TABLE "pr_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "endReason" TEXT,
    "endNote" TEXT,
    "endAnnounced" BOOLEAN NOT NULL DEFAULT false,
    "guard" TEXT,
    "legacyUntil" TEXT,
    "expiresAt" DATETIME,
    "quietDeliveries" INTEGER NOT NULL DEFAULT 0,
    "filteredCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredAt" DATETIME,
    "since" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pr_subscriptions_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pr_subscriptions_prId_fkey" FOREIGN KEY ("prId") REFERENCES "pull_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pr_deliveries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "investigationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "wakeId" TEXT,
    "resends" INTEGER NOT NULL DEFAULT 0,
    "retryAt" DATETIME,
    "prevWakeId" TEXT,
    "deliveredAt" DATETIME,
    "parkedAt" DATETIME,
    "discardReason" TEXT
);

-- CreateTable
CREATE TABLE "pr_delivery_members" (
    "deliveryId" INTEGER NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'member',
    "withdrawnBy" TEXT,

    PRIMARY KEY ("deliveryId", "subscriptionId"),
    CONSTRAINT "pr_delivery_members_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "pr_deliveries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pr_delivery_members_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "pr_subscriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pr_own_writes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "writeKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "investigationId" TEXT,
    "by" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "hostId" TEXT,
    "textHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "pr_subscriptions_investigationId_idx" ON "pr_subscriptions"("investigationId");

-- CreateIndex
CREATE INDEX "pr_subscriptions_url_state_idx" ON "pr_subscriptions"("url", "state");

-- CreateIndex
CREATE INDEX "pr_subscriptions_prId_idx" ON "pr_subscriptions"("prId");

-- CreateIndex
CREATE INDEX "pr_deliveries_investigationId_state_idx" ON "pr_deliveries"("investigationId", "state");

-- CreateIndex
CREATE INDEX "pr_deliveries_wakeId_idx" ON "pr_deliveries"("wakeId");

-- CreateIndex
CREATE UNIQUE INDEX "pr_deliveries_investigationId_url_dedupeKey_key" ON "pr_deliveries"("investigationId", "url", "dedupeKey");

-- CreateIndex
CREATE INDEX "pr_delivery_members_subscriptionId_state_idx" ON "pr_delivery_members"("subscriptionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "pr_own_writes_writeKey_key" ON "pr_own_writes"("writeKey");

-- CreateIndex
CREATE INDEX "pr_own_writes_url_idx" ON "pr_own_writes"("url");

-- Data (#1179): live feeds, their waiting lines and agent watches become subscriptions.
-- Specs are defaultSpec("auto"), equal to defaultSpec("user"), and oneShotSpec(until), stored resolved; prove-pr-subscriptions-migration checks them.
INSERT INTO "pr_subscriptions" ("id","investigationId","prId","url","createdBy","spec","state","since","createdAt","updatedAt")
SELECT lower(hex(randomblob(16))), f."investigationId", f."prId", p."url",
       CASE WHEN f."auto" = 1 THEN 'auto' ELSE 'user' END,
       '{"events":["comments","reviews","review_threads","checks","pushes","merge_close","conflicts"],"filter":{"authors":{"minAssociation":"any","reviewersOnly":false,"include":[],"exclude":[],"bots":true},"reviews":{"verdicts":["approved","changes_requested","commented","dismissed"]},"checks":{"conclusions":["failing","passing"],"names":[],"summary":true},"pushes":{"forcedOnly":true}},"delivery":"wake","once":false}',
       'active', f."since", f."since", CURRENT_TIMESTAMP
FROM "pr_feed" f JOIN "pull_requests" p ON p."id" = f."prId"
WHERE f."state" IN ('watching','disconnected');

INSERT INTO "pr_deliveries" ("investigationId","url","dedupeKey","kind","payload","occurredAt","detectedAt","state")
SELECT f."investigationId", p."url", 'legacy:' || f."prId", 'legacy', f."pending", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'queued'
FROM "pr_feed" f JOIN "pull_requests" p ON p."id" = f."prId"
WHERE f."pending" IS NOT NULL AND f."state" IN ('watching','disconnected');

INSERT INTO "pr_delivery_members" ("deliveryId","subscriptionId","state")
SELECT d."id", s."id", 'member' FROM "pr_deliveries" d
JOIN "pr_subscriptions" s ON s."investigationId" = d."investigationId" AND s."url" = d."url" AND s."createdBy" <> 'agent'
WHERE d."kind" = 'legacy';

INSERT INTO "pr_subscriptions" ("id","investigationId","prId","url","createdBy","spec","state","legacyUntil","expiresAt","since","createdAt","updatedAt")
SELECT lower(hex(randomblob(16))), w."investigationId", w."prId", p."url", 'agent',
  CASE w."until" WHEN 'checks_done' THEN '{"events":["checks","merge_close"],"filter":{"authors":{"minAssociation":"collaborator","reviewersOnly":false,"include":[],"exclude":[],"bots":false},"reviews":{"verdicts":["approved","changes_requested","commented","dismissed"]},"checks":{"conclusions":[],"names":[],"summary":true},"pushes":{"forcedOnly":true}},"delivery":"wake","once":true}' WHEN 'review' THEN '{"events":["reviews","merge_close"],"filter":{"authors":{"minAssociation":"any","reviewersOnly":false,"include":[],"exclude":[],"bots":true},"reviews":{"verdicts":["approved","changes_requested"]},"checks":{"conclusions":["failing"],"names":[],"summary":true},"pushes":{"forcedOnly":true}},"delivery":"wake","once":true}' ELSE '{"events":["merge_close"],"filter":{"authors":{"minAssociation":"collaborator","reviewersOnly":false,"include":[],"exclude":[],"bots":false},"reviews":{"verdicts":["approved","changes_requested","commented","dismissed"]},"checks":{"conclusions":["failing"],"names":[],"summary":true},"pushes":{"forcedOnly":true}},"delivery":"wake","once":true}' END,
  'active', w."until", w."expiresAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pr_watches" w JOIN "pull_requests" p ON p."id" = w."prId";

-- The loop guard no longer pauses a thread (#1179 OBJ-034).
UPDATE "investigations" SET "autoPause" = NULL WHERE "autoPause" LIKE '%"reason":"loop_guard"%';
