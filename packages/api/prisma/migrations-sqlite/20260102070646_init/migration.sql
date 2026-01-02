-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "globalRole" TEXT NOT NULL DEFAULT 'member',
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "resetPasswordToken" TEXT,
    "resetPasswordExpiration" DATETIME,
    "invitationToken" TEXT,
    "isPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'service',
    "tier" TEXT NOT NULL DEFAULT 'tier_3',
    "team" TEXT,
    "slackChannel" TEXT,
    "repository" TEXT,
    "tags" TEXT,
    "metadata" TEXT,
    "discoverySource" TEXT,
    "discoveryMetadata" TEXT,
    "isDiscovered" BOOLEAN NOT NULL DEFAULT false,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "service_dependencies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dependentId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL DEFAULT 'runtime',
    "criticality" TEXT NOT NULL DEFAULT 'required',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_dependencies_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_dependencies_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventTime" DATETIME,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "alertId" TEXT,
    CONSTRAINT "events_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupKey" TEXT NOT NULL,
    "fingerprint" TEXT,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'triggered',
    "source" TEXT,
    "sourceUrl" TEXT,
    "serviceId" TEXT,
    "tags" TEXT,
    "labels" TEXT,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" DATETIME,
    "resolvedAt" DATETIME,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastOccurrence" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "incidentId" TEXT,
    CONSTRAINT "alerts_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "alerts_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'triggered',
    "priority" TEXT NOT NULL DEFAULT 'p3',
    "serviceId" TEXT,
    "assignedToId" TEXT,
    "correlationReason" TEXT,
    "correlationRuleId" TEXT,
    "tags" TEXT,
    "customerImpact" TEXT,
    "affectedSystems" TEXT,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" DATETIME,
    "resolvedAt" DATETIME,
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "timeToAcknowledge" INTEGER,
    "timeToResolve" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "incidents_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incidents_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incidents_correlationRuleId_fkey" FOREIGN KEY ("correlationRuleId") REFERENCES "correlation_rules" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "investigations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "summary" TEXT,
    "rootCause" TEXT,
    "rootCauseCategory" TEXT,
    "confidence" REAL,
    "dataQuality" TEXT,
    "analysisMethod" TEXT,
    "dataSourcesUsed" TEXT,
    "rawOutput" TEXT,
    "error" TEXT,
    "agentProgression" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "investigations_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentType" TEXT NOT NULL DEFAULT 'llm',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "executionTimeMs" INTEGER,
    "output" TEXT,
    "confidence" REAL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_executions_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentExecutionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolCategory" TEXT,
    "arguments" TEXT,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executionTimeMs" INTEGER,
    "confidence" REAL,
    "dataQuality" TEXT,
    "error" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tool_executions_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "agent_executions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "category" TEXT,
    "urgency" TEXT,
    "actionable" BOOLEAN NOT NULL DEFAULT true,
    "estimatedEffort" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "implementedAt" DATETIME,
    "implementedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "recommendations_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "timeline_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" TEXT,
    "source" TEXT NOT NULL DEFAULT 'system',
    "userId" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "timeline_entries_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "timeline_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "postmortems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "timeline" TEXT,
    "whatHappened" TEXT,
    "whyItHappened" TEXT,
    "whatWeLearned" TEXT,
    "actionItems" TEXT,
    "customerImpact" TEXT,
    "financialImpact" REAL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "postmortems_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "postmortems_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "correlation_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchCriteria" TEXT NOT NULL,
    "timeWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "action" TEXT NOT NULL DEFAULT 'correlate',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "category" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "integration_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "configSchema" TEXT,
    "oauthConfig" TEXT,
    "iconUrl" TEXT,
    "docsUrl" TEXT,
    "maxConnectionsCE" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "definitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastHealthCheck" DATETIME,
    "lastError" TEXT,
    "authMethod" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "config" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "integration_connections_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "integration_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "service_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "config" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "service_integrations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_integrations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alert_mapping_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchCriteria" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "alert_mapping_rules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "service_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "suggestedName" TEXT NOT NULL,
    "displayName" TEXT,
    "repository" TEXT NOT NULL,
    "isMonorepo" BOOLEAN NOT NULL DEFAULT false,
    "subPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "service_suggestions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "service_dependencies_dependentId_dependencyId_key" ON "service_dependencies"("dependentId", "dependencyId");

-- CreateIndex
CREATE INDEX "events_source_sourceEventId_idx" ON "events"("source", "sourceEventId");

-- CreateIndex
CREATE INDEX "events_receivedAt_idx" ON "events"("receivedAt");

-- CreateIndex
CREATE INDEX "events_processed_idx" ON "events"("processed");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_dedupKey_key" ON "alerts"("dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_externalId_key" ON "alerts"("externalId");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_serviceId_idx" ON "alerts"("serviceId");

-- CreateIndex
CREATE INDEX "alerts_incidentId_idx" ON "alerts"("incidentId");

-- CreateIndex
CREATE INDEX "alerts_triggeredAt_idx" ON "alerts"("triggeredAt");

-- CreateIndex
CREATE INDEX "alerts_fingerprint_idx" ON "alerts"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_number_key" ON "incidents"("number");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_severity_idx" ON "incidents"("severity");

-- CreateIndex
CREATE INDEX "incidents_priority_idx" ON "incidents"("priority");

-- CreateIndex
CREATE INDEX "incidents_serviceId_idx" ON "incidents"("serviceId");

-- CreateIndex
CREATE INDEX "incidents_triggeredAt_idx" ON "incidents"("triggeredAt");

-- CreateIndex
CREATE INDEX "investigations_incidentId_idx" ON "investigations"("incidentId");

-- CreateIndex
CREATE INDEX "investigations_status_idx" ON "investigations"("status");

-- CreateIndex
CREATE INDEX "agent_executions_investigationId_idx" ON "agent_executions"("investigationId");

-- CreateIndex
CREATE INDEX "agent_executions_agentName_idx" ON "agent_executions"("agentName");

-- CreateIndex
CREATE INDEX "tool_executions_agentExecutionId_idx" ON "tool_executions"("agentExecutionId");

-- CreateIndex
CREATE INDEX "tool_executions_toolName_idx" ON "tool_executions"("toolName");

-- CreateIndex
CREATE INDEX "recommendations_investigationId_idx" ON "recommendations"("investigationId");

-- CreateIndex
CREATE INDEX "recommendations_status_idx" ON "recommendations"("status");

-- CreateIndex
CREATE INDEX "recommendations_priority_idx" ON "recommendations"("priority");

-- CreateIndex
CREATE INDEX "timeline_entries_incidentId_idx" ON "timeline_entries"("incidentId");

-- CreateIndex
CREATE INDEX "timeline_entries_occurredAt_idx" ON "timeline_entries"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "postmortems_incidentId_key" ON "postmortems"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "correlation_rules_name_key" ON "correlation_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "integration_definitions_name_key" ON "integration_definitions"("name");

-- CreateIndex
CREATE INDEX "integration_connections_status_idx" ON "integration_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_definitionId_name_key" ON "integration_connections"("definitionId", "name");

-- CreateIndex
CREATE INDEX "service_integrations_serviceId_idx" ON "service_integrations"("serviceId");

-- CreateIndex
CREATE INDEX "service_integrations_connectionId_idx" ON "service_integrations"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "service_integrations_serviceId_connectionId_key" ON "service_integrations"("serviceId", "connectionId");

-- CreateIndex
CREATE INDEX "alert_mapping_rules_priority_idx" ON "alert_mapping_rules"("priority");

-- CreateIndex
CREATE INDEX "alert_mapping_rules_enabled_idx" ON "alert_mapping_rules"("enabled");

-- CreateIndex
CREATE INDEX "alert_mapping_rules_serviceId_idx" ON "alert_mapping_rules"("serviceId");

-- CreateIndex
CREATE INDEX "service_suggestions_status_idx" ON "service_suggestions"("status");

-- CreateIndex
CREATE INDEX "service_suggestions_connectionId_idx" ON "service_suggestions"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "service_suggestions_connectionId_repository_subPath_key" ON "service_suggestions"("connectionId", "repository", "subPath");
