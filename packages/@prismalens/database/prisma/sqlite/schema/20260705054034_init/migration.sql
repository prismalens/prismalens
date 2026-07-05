-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'service',
    "tier" TEXT NOT NULL DEFAULT 'tier_3',
    "team" TEXT,
    "slackChannel" TEXT,
    "tags" TEXT,
    "metadata" TEXT,
    "discoveryMetadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "connectionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "repositories_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "service_repositories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "subPath" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_repositories_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_repositories_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "serviceId" TEXT,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT,
    "environment" TEXT,
    "deploymentType" TEXT,
    "region" TEXT,
    "branch" TEXT,
    "repositoryUrl" TEXT,
    "metadata" TEXT,
    "lastDeployedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "deployments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deployments_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "tenantId" TEXT,
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
    "tenantId" TEXT,
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
    "tenantId" TEXT,
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
    CONSTRAINT "incidents_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incidents_correlationRuleId_fkey" FOREIGN KEY ("correlationRuleId") REFERENCES "correlation_rules" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "investigations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "summary" TEXT,
    "rootCause" TEXT,
    "rootCauseCategory" TEXT,
    "report" TEXT,
    "overlay" TEXT,
    "error" TEXT,
    "harnessThreadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "triggerType" TEXT,
    "triggerReason" TEXT,
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
    "branchId" TEXT,
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
CREATE TABLE "investigation_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "investigationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "investigation_events_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "timeline_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "postmortems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
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
    CONSTRAINT "postmortems_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "serviceId" TEXT,
    "description" TEXT,
    "metadata" TEXT,
    "riskScore" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "change_events_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incident_similarities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "similarIncidentId" TEXT NOT NULL,
    "similarityScore" INTEGER NOT NULL,
    "matchFactors" TEXT,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "correlation_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
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
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "category" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "alert_mapping_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
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
CREATE TABLE "license_info" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseKey" TEXT,
    "licenseType" TEXT NOT NULL DEFAULT 'none',
    "tier" TEXT NOT NULL DEFAULT 'community',
    "validUntil" DATETIME,
    "activatedAt" DATETIME,
    "lastValidated" DATETIME,
    "features" TEXT NOT NULL DEFAULT '[]',
    "quotas" TEXT NOT NULL DEFAULT '{}',
    "billingCycle" TEXT,
    "seats" INTEGER,
    "cloudInstanceId" TEXT,
    "isCloudManaged" BOOLEAN NOT NULL DEFAULT false,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "banned" BOOLEAN,
    "banReason" TEXT,
    "banExpires" DATETIME
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "twoFactorVerified" BOOLEAN,
    "activeOrganizationId" TEXT,
    "impersonatedBy" TEXT,
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inviterId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT,
    "label" TEXT NOT NULL,
    "clientIdEnc" BLOB,
    "clientSecretEnc" BLOB,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "callbackUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "integrationId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
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

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "callbackUrl" TEXT NOT NULL,
    "connectionConfigEnc" BLOB,
    "codeVerifier" TEXT,
    "metadata" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CONSTRAINT "service_integrations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "sourceType" TEXT NOT NULL DEFAULT 'repository',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" TEXT,
    "statusChangedAt" DATETIME,
    "acceptedServiceId" TEXT,
    "acceptedDeploymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "service_suggestions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_suggestions_acceptedServiceId_fkey" FOREIGN KEY ("acceptedServiceId") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "service_suggestions_acceptedDeploymentId_fkey" FOREIGN KEY ("acceptedDeploymentId") REFERENCES "deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_connectionId_fullName_key" ON "repositories"("connectionId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "service_repositories_serviceId_repositoryId_subPath_key" ON "service_repositories"("serviceId", "repositoryId", "subPath");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_connectionId_externalId_key" ON "deployments"("connectionId", "externalId");

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
CREATE UNIQUE INDEX "investigations_harnessThreadId_key" ON "investigations"("harnessThreadId");

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
CREATE INDEX "investigation_events_investigationId_seq_idx" ON "investigation_events"("investigationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_events_investigationId_branchId_seq_key" ON "investigation_events"("investigationId", "branchId", "seq");

-- CreateIndex
CREATE INDEX "timeline_entries_incidentId_idx" ON "timeline_entries"("incidentId");

-- CreateIndex
CREATE INDEX "timeline_entries_occurredAt_idx" ON "timeline_entries"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "postmortems_incidentId_key" ON "postmortems"("incidentId");

-- CreateIndex
CREATE INDEX "change_events_serviceId_timestamp_idx" ON "change_events"("serviceId", "timestamp");

-- CreateIndex
CREATE INDEX "change_events_timestamp_idx" ON "change_events"("timestamp");

-- CreateIndex
CREATE INDEX "change_events_type_idx" ON "change_events"("type");

-- CreateIndex
CREATE INDEX "incident_similarities_incidentId_idx" ON "incident_similarities"("incidentId");

-- CreateIndex
CREATE INDEX "incident_similarities_similarIncidentId_idx" ON "incident_similarities"("similarIncidentId");

-- CreateIndex
CREATE INDEX "incident_similarities_similarityScore_idx" ON "incident_similarities"("similarityScore");

-- CreateIndex
CREATE UNIQUE INDEX "incident_similarities_incidentId_similarIncidentId_key" ON "incident_similarities"("incidentId", "similarIncidentId");

-- CreateIndex
CREATE UNIQUE INDEX "correlation_rules_name_key" ON "correlation_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "alert_mapping_rules_priority_idx" ON "alert_mapping_rules"("priority");

-- CreateIndex
CREATE INDEX "alert_mapping_rules_enabled_idx" ON "alert_mapping_rules"("enabled");

-- CreateIndex
CREATE INDEX "alert_mapping_rules_serviceId_idx" ON "alert_mapping_rules"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "license_info_licenseKey_key" ON "license_info"("licenseKey");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "member_userId_organizationId_key" ON "member"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "integrations_templateId_idx" ON "integrations"("templateId");

-- CreateIndex
CREATE INDEX "connections_integrationId_userId_idx" ON "connections"("integrationId", "userId");

-- CreateIndex
CREATE INDEX "connections_userId_idx" ON "connections"("userId");

-- CreateIndex
CREATE INDEX "connections_status_idx" ON "connections"("status");

-- CreateIndex
CREATE INDEX "connections_tokenExpiresAt_idx" ON "connections"("tokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "oauth_states_state_idx" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "oauth_states_expiresAt_idx" ON "oauth_states"("expiresAt");

-- CreateIndex
CREATE INDEX "service_integrations_serviceId_idx" ON "service_integrations"("serviceId");

-- CreateIndex
CREATE INDEX "service_integrations_connectionId_idx" ON "service_integrations"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "service_integrations_serviceId_connectionId_key" ON "service_integrations"("serviceId", "connectionId");

-- CreateIndex
CREATE INDEX "service_suggestions_status_idx" ON "service_suggestions"("status");

-- CreateIndex
CREATE INDEX "service_suggestions_connectionId_idx" ON "service_suggestions"("connectionId");

-- CreateIndex
CREATE INDEX "service_suggestions_acceptedServiceId_idx" ON "service_suggestions"("acceptedServiceId");

-- CreateIndex
CREATE INDEX "service_suggestions_acceptedDeploymentId_idx" ON "service_suggestions"("acceptedDeploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "service_suggestions_connectionId_repository_subPath_key" ON "service_suggestions"("connectionId", "repository", "subPath");
