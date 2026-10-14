-- CreateTable
CREATE TABLE "service_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'kubernetes',
    "kubeContext" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "kubeUser" TEXT,
    "detected" TEXT NOT NULL,
    "confirmedAt" DATETIME NOT NULL,
    "probeState" TEXT NOT NULL DEFAULT 'unchecked',
    "probeDetail" TEXT,
    "probedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "service_bindings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "captures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bindingId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'k8s-alert-time',
    "checklistVersion" INTEGER NOT NULL,
    "canonicalQuery" TEXT NOT NULL,
    "queryDigest" TEXT NOT NULL,
    "kubeContext" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "identity" TEXT,
    "identityMatches" BOOLEAN,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "stateReason" TEXT,
    "missedFrom" DATETIME,
    "missedTo" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "caseStartedAt" DATETIME NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "lastError" TEXT,
    "bytesStored" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "captures_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "service_bindings" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_captures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "alertId" TEXT,
    "triggeredAt" DATETIME NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_captures_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_captures_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "captures" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "capture_artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "captureId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "subject" TEXT,
    "command" TEXT NOT NULL,
    "retrieval" TEXT NOT NULL,
    "retrievalReason" TEXT,
    "exitCode" INTEGER,
    "stderrTail" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "sourceFrom" DATETIME,
    "sourceTo" DATETIME,
    "rawBytes" INTEGER NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "redactedBytes" INTEGER NOT NULL,
    "redactedSha256" TEXT NOT NULL,
    "redactions" TEXT NOT NULL,
    "expiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capture_artifacts_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "captures" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "manifest_entries" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "captureId" TEXT NOT NULL,
    "artifactId" TEXT,
    "body" TEXT NOT NULL,
    "prevDigest" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    CONSTRAINT "manifest_entries_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "captures" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_nodes_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_edges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_edges_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_edges_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "case_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_edges_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "case_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "claim_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "nodeId" TEXT,
    "edgeId" TEXT,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusReason" TEXT,
    "statement" TEXT NOT NULL,
    "attributes" TEXT,
    "sourceKind" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "artifactId" TEXT,
    "population" TEXT,
    "coverage" TEXT,
    "sourceTime" DATETIME,
    "validKind" TEXT NOT NULL,
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "collectedAt" DATETIME,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "claim_revisions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "claim_revisions_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "case_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "claim_revisions_edgeId_fkey" FOREIGN KEY ("edgeId") REFERENCES "case_edges" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "claim_revisions_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "capture_artifacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "service_bindings_serviceId_key" ON "service_bindings"("serviceId");

-- CreateIndex
CREATE INDEX "captures_state_dueAt_priority_idx" ON "captures"("state", "dueAt", "priority");

-- CreateIndex
CREATE INDEX "captures_queryDigest_state_idx" ON "captures"("queryDigest", "state");

-- CreateIndex
CREATE INDEX "case_captures_captureId_idx" ON "case_captures"("captureId");

-- CreateIndex
CREATE UNIQUE INDEX "case_captures_incidentId_captureId_key" ON "case_captures"("incidentId", "captureId");

-- CreateIndex
CREATE UNIQUE INDEX "capture_artifacts_captureId_seq_key" ON "capture_artifacts"("captureId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "manifest_entries_digest_key" ON "manifest_entries"("digest");

-- CreateIndex
CREATE INDEX "manifest_entries_captureId_idx" ON "manifest_entries"("captureId");

-- CreateIndex
CREATE UNIQUE INDEX "case_nodes_incidentId_key_key" ON "case_nodes"("incidentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "case_edges_fromNodeId_toNodeId_relation_key" ON "case_edges"("fromNodeId", "toNodeId", "relation");

-- CreateIndex
CREATE INDEX "claim_revisions_incidentId_recordedAt_idx" ON "claim_revisions"("incidentId", "recordedAt");

-- CreateIndex
CREATE INDEX "claim_revisions_nodeId_revision_idx" ON "claim_revisions"("nodeId", "revision");

-- CreateIndex
CREATE INDEX "claim_revisions_edgeId_revision_idx" ON "claim_revisions"("edgeId", "revision");

-- Claim revisions and manifest entries are written once and never changed.
CREATE TRIGGER "claim_revisions_append_only" BEFORE UPDATE ON "claim_revisions" BEGIN SELECT RAISE(ABORT, 'claim_revisions is append-only'); END;
CREATE TRIGGER "manifest_entries_append_only" BEFORE UPDATE ON "manifest_entries" BEGIN SELECT RAISE(ABORT, 'manifest_entries is append-only'); END;
