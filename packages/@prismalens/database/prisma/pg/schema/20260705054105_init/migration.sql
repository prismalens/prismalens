-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('service', 'database', 'queue', 'cache', 'gateway', 'external', 'infrastructure');

-- CreateEnum
CREATE TYPE "ServiceTier" AS ENUM ('tier_1', 'tier_2', 'tier_3', 'tier_4');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('runtime', 'build', 'data');

-- CreateEnum
CREATE TYPE "DependencyCriticality" AS ENUM ('required', 'optional', 'degraded');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('triggered', 'acknowledged', 'correlated', 'resolved', 'suppressed');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('triggered', 'investigating', 'identified', 'monitoring', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('p1', 'p2', 'p3', 'p4', 'p5');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "RootCauseCategory" AS ENUM ('code', 'config', 'infrastructure', 'external', 'unknown');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('llm', 'sequential', 'loop');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('pending', 'running', 'success', 'error');

-- CreateEnum
CREATE TYPE "ToolCategory" AS ENUM ('file', 'search', 'github', 'logs', 'analysis');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "RecommendationCategory" AS ENUM ('code_fix', 'config_change', 'rollback', 'monitoring', 'investigation');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('immediate', 'short_term', 'long_term');

-- CreateEnum
CREATE TYPE "EffortEstimate" AS ENUM ('minutes', 'hours', 'days');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('pending', 'in_progress', 'completed', 'rejected', 'deferred');

-- CreateEnum
CREATE TYPE "TimelineEntryType" AS ENUM ('incident_created', 'alert_added', 'alert_removed', 'status_changed', 'severity_changed', 'assigned', 'investigation_started', 'investigation_completed', 'recommendation_added', 'recommendation_completed', 'comment', 'postmortem_created', 'custom');

-- CreateEnum
CREATE TYPE "TimelineSource" AS ENUM ('system', 'user', 'ai_worker');

-- CreateEnum
CREATE TYPE "PostmortemStatus" AS ENUM ('draft', 'in_review', 'published', 'archived');

-- CreateEnum
CREATE TYPE "CorrelationAction" AS ENUM ('correlate', 'suppress', 'create_incident');

-- CreateEnum
CREATE TYPE "SettingType" AS ENUM ('string', 'number', 'boolean', 'json', 'encrypted');

-- CreateEnum
CREATE TYPE "SettingCategory" AS ENUM ('general', 'correlation', 'ai', 'notifications', 'setup');

-- CreateEnum
CREATE TYPE "InvestigationTriggerType" AS ENUM ('manual', 'auto_critical', 'auto_tier', 'alert_threshold', 'scheduled', 're_trigger');

-- CreateEnum
CREATE TYPE "ChangeEventType" AS ENUM ('deployment', 'config', 'migration', 'commit', 'rollback');

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('none', 'subscription');

-- CreateEnum
CREATE TYPE "LicenseTier" AS ENUM ('community', 'enterprise');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'REFRESH_FAILED', 'CREDENTIALS_INVALID', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'accepted', 'rejected', 'ignored');

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "type" "ServiceType" NOT NULL DEFAULT 'service',
    "tier" "ServiceTier" NOT NULL DEFAULT 'tier_3',
    "team" TEXT,
    "slackChannel" TEXT,
    "tags" TEXT,
    "metadata" TEXT,
    "discoveryMetadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "connectionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_repositories" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "subPath" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
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
    "lastDeployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_dependencies" (
    "id" TEXT NOT NULL,
    "dependentId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "dependencyType" "DependencyType" NOT NULL DEFAULT 'runtime',
    "criticality" "DependencyCriticality" NOT NULL DEFAULT 'required',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "source" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventTime" TIMESTAMP(3),
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "alertId" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "fingerprint" TEXT,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'medium',
    "status" "AlertStatus" NOT NULL DEFAULT 'triggered',
    "source" TEXT,
    "sourceUrl" TEXT,
    "serviceId" TEXT,
    "tags" TEXT,
    "labels" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastOccurrence" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "incidentId" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'medium',
    "status" "IncidentStatus" NOT NULL DEFAULT 'triggered',
    "priority" "Priority" NOT NULL DEFAULT 'p3',
    "serviceId" TEXT,
    "assignedToId" TEXT,
    "correlationReason" TEXT,
    "correlationRuleId" TEXT,
    "tags" TEXT,
    "customerImpact" TEXT,
    "affectedSystems" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "timeToAcknowledge" INTEGER,
    "timeToResolve" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "incidentId" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" TEXT,
    "rootCause" TEXT,
    "rootCauseCategory" "RootCauseCategory",
    "report" JSONB,
    "overlay" JSONB,
    "error" TEXT,
    "harnessThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "triggerType" "InvestigationTriggerType",
    "triggerReason" TEXT,

    CONSTRAINT "investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL DEFAULT 'llm',
    "status" "ExecutionStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "executionTimeMs" INTEGER,
    "output" TEXT,
    "branchId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" TEXT NOT NULL,
    "agentExecutionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolCategory" "ToolCategory",
    "arguments" TEXT,
    "result" TEXT,
    "status" "ToolExecutionStatus" NOT NULL DEFAULT 'pending',
    "executionTimeMs" INTEGER,
    "dataQuality" TEXT,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "RecommendationPriority" NOT NULL DEFAULT 'medium',
    "category" "RecommendationCategory",
    "urgency" "Urgency",
    "actionable" BOOLEAN NOT NULL DEFAULT true,
    "estimatedEffort" "EffortEstimate",
    "status" "RecommendationStatus" NOT NULL DEFAULT 'pending',
    "implementedAt" TIMESTAMP(3),
    "implementedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_events" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_entries" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "TimelineEntryType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" TEXT,
    "source" "TimelineSource" NOT NULL DEFAULT 'system',
    "userId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postmortems" (
    "id" TEXT NOT NULL,
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
    "financialImpact" DOUBLE PRECISION,
    "status" "PostmortemStatus" NOT NULL DEFAULT 'draft',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "postmortems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" "ChangeEventType" NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "serviceId" TEXT,
    "description" TEXT,
    "metadata" TEXT,
    "riskScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_similarities" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "similarIncidentId" TEXT NOT NULL,
    "similarityScore" INTEGER NOT NULL,
    "matchFactors" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_similarities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchCriteria" TEXT NOT NULL,
    "timeWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "action" "CorrelationAction" NOT NULL DEFAULT 'correlate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correlation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "SettingType" NOT NULL DEFAULT 'string',
    "category" "SettingCategory",
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_mapping_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchCriteria" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_mapping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_info" (
    "id" TEXT NOT NULL,
    "licenseKey" TEXT,
    "licenseType" "LicenseType" NOT NULL DEFAULT 'none',
    "tier" "LicenseTier" NOT NULL DEFAULT 'community',
    "validUntil" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastValidated" TIMESTAMP(3),
    "features" TEXT NOT NULL DEFAULT '[]',
    "quotas" TEXT NOT NULL DEFAULT '{}',
    "billingCycle" TEXT,
    "seats" INTEGER,
    "cloudInstanceId" TEXT,
    "isCloudManaged" BOOLEAN NOT NULL DEFAULT false,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "banned" BOOLEAN,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "twoFactorVerified" BOOLEAN,
    "activeOrganizationId" TEXT,
    "impersonatedBy" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inviterId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT,
    "label" TEXT NOT NULL,
    "clientIdEnc" BYTEA,
    "clientSecretEnc" BYTEA,
    "scopes" TEXT[],
    "callbackUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "integrationId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "connectionConfigEnc" BYTEA,
    "credentialsEnc" BYTEA NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenType" TEXT,
    "grantedScopes" TEXT[],
    "metadataEnc" BYTEA,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "callbackUrl" TEXT NOT NULL,
    "connectionConfigEnc" BYTEA,
    "codeVerifier" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_integrations" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "config" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_suggestions" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "suggestedName" TEXT NOT NULL,
    "displayName" TEXT,
    "repository" TEXT NOT NULL,
    "isMonorepo" BOOLEAN NOT NULL DEFAULT false,
    "subPath" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'repository',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "metadata" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "acceptedServiceId" TEXT,
    "acceptedDeploymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_suggestions_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_repositories" ADD CONSTRAINT "service_repositories_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_repositories" ADD CONSTRAINT "service_repositories_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_correlationRuleId_fkey" FOREIGN KEY ("correlationRuleId") REFERENCES "correlation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_agentExecutionId_fkey" FOREIGN KEY ("agentExecutionId") REFERENCES "agent_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_events" ADD CONSTRAINT "investigation_events_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_mapping_rules" ADD CONSTRAINT "alert_mapping_rules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_integrations" ADD CONSTRAINT "service_integrations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_integrations" ADD CONSTRAINT "service_integrations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_suggestions" ADD CONSTRAINT "service_suggestions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_suggestions" ADD CONSTRAINT "service_suggestions_acceptedServiceId_fkey" FOREIGN KEY ("acceptedServiceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_suggestions" ADD CONSTRAINT "service_suggestions_acceptedDeploymentId_fkey" FOREIGN KEY ("acceptedDeploymentId") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
