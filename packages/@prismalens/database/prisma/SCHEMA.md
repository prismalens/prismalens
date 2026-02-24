# PrismaLens Database Schema

This document describes the database schema for PrismaLens, an AI-powered incident management platform.

## Architecture Overview

PrismaLens uses an **incident-centric** architecture, following industry patterns from PagerDuty, Datadog, and BigPanda. The core concept is that multiple alerts are correlated into a single incident, which is then investigated by AI workers.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Webhook → Event → Alert → Incident → Investigation → Recommendations       │
│            (raw)   (dedup)  (correlate)  (AI work)      (solutions)         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Entity Relationship Diagram

```
┌─────────────┐
│   Service   │◄──────────────────────────────────────────┐
│  (catalog)  │                                           │
└──────┬──────┘                                           │
       │ 1:N                                              │
       ▼                                                  │
┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│    Event    │────►│    Alert    │────►│  Incident   │──┘
│   (raw)     │ 1:1 │ (deduped)   │ N:1 │ (correlated)│
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │ 1:N
                           ┌───────────────────┼───────────────────┐
                           ▼                   ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                    │Investigation│     │  Timeline   │     │ Postmortem  │
                    │  (AI work)  │     │  (log)      │     │ (learnings) │
                    └──────┬──────┘     └─────────────┘     └─────────────┘
                           │ 1:N
                    ┌──────┴──────┐
                    ▼             ▼
             ┌─────────────┐ ┌─────────────┐
             │   Agent     │ │Recommendation│
             │ Execution   │ │             │
             └──────┬──────┘ └─────────────┘
                    │ 1:N
                    ▼
             ┌─────────────┐
             │    Tool     │
             │ Execution   │
             └─────────────┘
```

## Core Entities

### Event
Raw, immutable signals from monitoring systems. Events capture exactly what was received before any processing.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `source` | string | Source system: `prometheus`, `github`, `render`, `generic` |
| `sourceEventId` | string? | ID from source for deduplication |
| `eventType` | string | Type: `alert`, `deployment`, `commit` |
| `payload` | string | Full raw JSON payload |
| `receivedAt` | datetime | When received by PrismaLens |
| `eventTime` | datetime? | When event actually occurred |
| `processed` | boolean | Whether event has been processed |
| `alertId` | UUID? | FK to Alert created from this event |

### Alert
Deduplicated, normalized signals with state tracking. Multiple events with the same `dedupKey` update a single alert.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `dedupKey` | string | **Unique** hash for deduplication |
| `fingerprint` | string? | Content similarity hash |
| `externalId` | string? | Original ID from source |
| `title` | string | Alert title |
| `description` | string? | Detailed description |
| `severity` | Severity | See [Severity](#severity) |
| `status` | AlertStatus | See [AlertStatus](#alertstatus) |
| `source` | string? | Source system |
| `sourceUrl` | string? | Link to source |
| `serviceId` | UUID? | FK to Service |
| `tags` | JSON | Array of tags for correlation |
| `labels` | JSON | Key-value labels |
| `triggeredAt` | datetime | When alert first fired |
| `occurrenceCount` | int | Number of times dedupKey fired |
| `incidentId` | UUID? | FK to correlated Incident |

### Incident
The main work unit - a single business problem that may involve multiple correlated alerts.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `number` | int | **Unique** human-readable number (INC-123) |
| `title` | string | Incident title |
| `description` | string? | Detailed description |
| `severity` | Severity | See [Severity](#severity) |
| `status` | IncidentStatus | See [IncidentStatus](#incidentstatus) |
| `priority` | Priority | See [Priority](#priority) |
| `serviceId` | UUID? | FK to primary affected Service |
| `correlationReason` | string? | Why alerts were grouped |
| `alertCount` | int | Number of correlated alerts |
| `timeToAcknowledge` | int? | Seconds to acknowledge |
| `timeToResolve` | int? | Seconds to resolve |

### Investigation
AI-driven analysis of an incident. Each investigation runs the multi-agent workflow.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `incidentId` | UUID | FK to Incident |
| `status` | WorkflowStatus | See [WorkflowStatus](#workflowstatus) |
| `summary` | string? | Executive summary of findings |
| `rootCause` | string? | Identified root cause |
| `rootCauseCategory` | RootCauseCategory? | See [RootCauseCategory](#rootcausecategory) |
| `confidence` | float? | Confidence score (0.0 to 1.0) |
| `dataQuality` | JSON | Quality scores per data source |
| `dataSourcesUsed` | JSON | Array of data source names used |
| `rawOutput` | string? | Full agent workflow output (JSON) for debugging |
| `error` | string? | Error message if status is "failed" |
| `langGraphThreadId` | string? | **Unique** LangGraph checkpoint thread ID for resume/replay |
| `triggerType` | InvestigationTriggerType? | How this investigation was triggered |
| `triggerReason` | string? | Human-readable trigger reason |

### Service
Monitored components - "what can break". Used for topology-based correlation.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | **Unique** identifier (e.g., `api-gateway`) |
| `displayName` | string? | Human-readable name |
| `type` | ServiceType | See [ServiceType](#servicetype) |
| `tier` | ServiceTier | See [ServiceTier](#servicetier) |
| `repository` | string? | GitHub repo for AI code analysis |
| `tags` | JSON | Array of tags |

## Supporting Entities

### AgentExecution
Tracks each agent's contribution to an investigation.

| Field | Type | Description |
|-------|------|-------------|
| `agentName` | string | Agent identifier (extensible) |
| `agentType` | AgentType | See [AgentType](#agenttype) |
| `status` | ExecutionStatus | See [ExecutionStatus](#executionstatus) |
| `executionTimeMs` | int? | Execution time in milliseconds |
| `confidence` | float? | Agent's confidence (0.0 to 1.0) |
| `inputTokens` | int? | LLM input tokens |
| `outputTokens` | int? | LLM output tokens |

### ToolExecution
Tracks each tool call made by agents.

| Field | Type | Description |
|-------|------|-------------|
| `toolName` | string | Tool identifier |
| `toolCategory` | ToolCategory? | See [ToolCategory](#toolcategory) |
| `arguments` | JSON | Tool arguments |
| `result` | JSON | Tool result |
| `status` | ToolExecutionStatus | See [ToolExecutionStatus](#toolexecutionstatus) |
| `executionTimeMs` | int? | Execution time |

### Recommendation
Actionable solutions generated by the AI.

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Recommendation title |
| `priority` | RecommendationPriority | See [RecommendationPriority](#recommendationpriority) |
| `category` | RecommendationCategory? | See [RecommendationCategory](#recommendationcategory) |
| `urgency` | Urgency? | See [Urgency](#urgency) |
| `estimatedEffort` | EffortEstimate? | See [EffortEstimate](#effortestimate) |
| `status` | RecommendationStatus | See [RecommendationStatus](#recommendationstatus) |

### TimelineEntry
Activity log for incidents.

| Field | Type | Description |
|-------|------|-------------|
| `type` | TimelineEntryType | See [TimelineEntryType](#timelineentrytype) |
| `title` | string | Entry title |
| `source` | TimelineSource | See [TimelineSource](#timelinesource) |

### Postmortem
Post-incident analysis and learnings.

| Field | Type | Description |
|-------|------|-------------|
| `summary` | string? | Executive summary |
| `whatHappened` | string? | What went wrong |
| `whyItHappened` | string? | Root cause analysis |
| `whatWeLearned` | string? | Key learnings |
| `actionItems` | JSON | Action items array |
| `status` | PostmortemStatus | See [PostmortemStatus](#postmortemstatus) |

### CorrelationRule
Configurable rules for grouping alerts into incidents.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | **Unique** rule name |
| `matchCriteria` | JSON | Match conditions |
| `timeWindowMinutes` | int | Group alerts within this window (default: 60) |
| `action` | CorrelationAction | See [CorrelationAction](#correlationaction) |
| `priority` | int | Lower = higher priority |

### Setting
System configuration key-value pairs.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | **Unique** setting key |
| `value` | string | JSON-encoded value |
| `type` | SettingType | See [SettingType](#settingtype) |
| `category` | SettingCategory? | See [SettingCategory](#settingcategory) |

### IntegrationConnection
User-configured integration instances with encrypted credentials.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | User-friendly name |
| `status` | ConnectionStatus | See [ConnectionStatus](#connectionstatus) |
| `authMethod` | AuthMethod | See [AuthMethod](#authmethod) |
| `credentials` | string | Encrypted JSON credentials |

### ServiceSuggestion
Auto-discovered services pending user confirmation.

| Field | Type | Description |
|-------|------|-------------|
| `suggestedName` | string | Suggested service name |
| `repository` | string | Repository path |
| `status` | SuggestionStatus | See [SuggestionStatus](#suggestionstatus) |

---

## Enum Reference

All enums are defined in the Prisma schema and exposed as TypeScript enums in the API.

### GlobalRole
User roles for access control.

| Value | Description |
|-------|-------------|
| `owner` | First user, full access |
| `admin` | Can manage users/settings |
| `member` | Can view incidents and postmortems |

### ServiceType
Service types for the service catalog.

| Value | Description |
|-------|-------------|
| `service` | Application service |
| `database` | Database (PostgreSQL, MySQL, etc.) |
| `queue` | Message queue (Redis, RabbitMQ, etc.) |
| `cache` | Cache layer (Redis, Memcached) |
| `gateway` | API gateway, load balancer |
| `external` | Third-party service |
| `infrastructure` | Infrastructure component (K8s, VM) |

### ServiceTier
Service tiers for prioritization.

| Value | Description |
|-------|-------------|
| `tier_1` | Business critical, immediate response required |
| `tier_2` | Important, response within hours |
| `tier_3` | Standard, response within day |
| `tier_4` | Low priority, best effort |

### DependencyType
Types of dependencies between services.

| Value | Description |
|-------|-------------|
| `runtime` | Runtime dependency (API calls) |
| `build` | Build-time dependency |
| `data` | Data dependency (shared DB) |

### DependencyCriticality
Criticality levels for service dependencies.

| Value | Description |
|-------|-------------|
| `required` | Service fails without dependency |
| `optional` | Service degrades without dependency |
| `degraded` | Service works but with reduced functionality |

### Severity
Severity levels for alerts and incidents.

| Value | Description |
|-------|-------------|
| `critical` | System down, immediate action required |
| `high` | Significant impact, action required soon |
| `medium` | Moderate impact, schedule fix |
| `low` | Minor issue, fix when convenient |
| `info` | Informational, no action required |

### AlertStatus
Alert status lifecycle.

| Value | Description |
|-------|-------------|
| `triggered` | Alert is active/firing |
| `acknowledged` | Someone/something is looking at it |
| `correlated` | Alert has been linked to an Incident |
| `resolved` | Alert condition cleared |
| `suppressed` | Manually suppressed/ignored |

### IncidentStatus
Incident status lifecycle.

| Value | Description |
|-------|-------------|
| `triggered` | Incident created, awaiting investigation |
| `investigating` | AI worker is analyzing |
| `identified` | Root cause identified |
| `monitoring` | Fix applied, monitoring for recurrence |
| `resolved` | Incident resolved |
| `closed` | Postmortem complete, incident closed |

### Priority
Priority levels for incidents.

| Value | Response Time |
|-------|---------------|
| `p1` | Immediate response required |
| `p2` | Response within 1 hour |
| `p3` | Response within 4 hours |
| `p4` | Response within 24 hours |
| `p5` | Best effort |

### WorkflowStatus
Investigation/workflow status.

| Value | Description |
|-------|-------------|
| `pending` | Queued for analysis |
| `running` | Agents are executing |
| `completed` | Analysis finished successfully |
| `failed` | Analysis failed with error |
| `cancelled` | Cancelled by user or system |

### RootCauseCategory
Root cause categories for investigations.

| Value | Description |
|-------|-------------|
| `code` | Bug in application code |
| `config` | Configuration error |
| `infrastructure` | Infrastructure issue |
| `external` | Third-party/external cause |
| `unknown` | Could not determine |

### AgentType
Types of AI agents.

| Value | Description |
|-------|-------------|
| `llm` | LLM-based agent |
| `sequential` | Sequential workflow agent |
| `loop` | Loop agent |

### ExecutionStatus
Execution status for agents.

| Value | Description |
|-------|-------------|
| `pending` | Not started |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Failed with error |

### ToolExecutionStatus
Tool execution status.

| Value | Description |
|-------|-------------|
| `pending` | Not started |
| `running` | Currently executing |
| `success` | Completed successfully |
| `error` | Failed with error |

### ToolCategory
Categories for tool executions.

| Value | Description |
|-------|-------------|
| `file` | File system operations |
| `search` | Code search |
| `github` | GitHub API |
| `logs` | Log retrieval |
| `analysis` | Analysis tools |

### RecommendationPriority
Priority levels for recommendations.

| Value | Description |
|-------|-------------|
| `critical` | Do this immediately |
| `high` | Do this soon |
| `medium` | Do when possible |
| `low` | Nice to have |

### RecommendationCategory
Categories for recommendations.

| Value | Description |
|-------|-------------|
| `code_fix` | Code change required |
| `config_change` | Configuration change |
| `rollback` | Rollback deployment |
| `monitoring` | Add/improve monitoring |
| `investigation` | Further investigation needed |

### Urgency
Urgency levels for recommendations.

| Value | Description |
|-------|-------------|
| `immediate` | Do within minutes |
| `short_term` | Do within hours |
| `long_term` | Do within days/weeks |

### EffortEstimate
Effort estimates for recommendations.

| Value | Description |
|-------|-------------|
| `minutes` | Quick fix |
| `hours` | Moderate effort |
| `days` | Significant effort |

### RecommendationStatus
Status for recommendation tracking.

| Value | Description |
|-------|-------------|
| `pending` | Not started |
| `in_progress` | Being worked on |
| `completed` | Implemented |
| `rejected` | Decided not to implement |
| `deferred` | Postponed for later |

### TimelineEntryType
Types of timeline entries.

| Value | Description |
|-------|-------------|
| `incident_created` | Incident was created |
| `alert_added` | Alert correlated to incident |
| `alert_removed` | Alert removed from incident |
| `status_changed` | Status was updated |
| `severity_changed` | Severity was updated |
| `assigned` | Incident was assigned |
| `investigation_started` | AI investigation began |
| `investigation_completed` | AI investigation finished |
| `recommendation_added` | Recommendation created |
| `recommendation_completed` | Recommendation implemented |
| `comment` | User added a comment |
| `postmortem_created` | Postmortem started |
| `custom` | Custom entry type |

### TimelineSource
Sources of timeline entries.

| Value | Description |
|-------|-------------|
| `system` | Automatically generated |
| `user` | Created by user |
| `ai_worker` | Created by AI worker |

### PostmortemStatus
Status for postmortems.

| Value | Description |
|-------|-------------|
| `draft` | Being written |
| `in_review` | Under review |
| `published` | Finalized and shared |
| `archived` | No longer active |

### CorrelationAction
Actions for correlation rules.

| Value | Description |
|-------|-------------|
| `correlate` | Add alert to existing incident (or create new) |
| `suppress` | Suppress the alert (don't create incident) |
| `create_incident` | Always create a new incident |

### SettingType
Value types for settings.

| Value | Description |
|-------|-------------|
| `string` | Plain string value |
| `number` | Numeric value |
| `boolean` | Boolean value |
| `json` | Complex JSON object |

### SettingCategory
Categories for settings.

| Value | Description |
|-------|-------------|
| `general` | General settings |
| `correlation` | Correlation settings |
| `ai` | AI/LLM settings |
| `notifications` | Notification settings |

### ConnectionStatus
Status for integration connections.

| Value | Description |
|-------|-------------|
| `pending` | Not yet connected |
| `connected` | Successfully connected |
| `error` | Connection error |
| `disabled` | Manually disabled |

### AuthMethod
Authentication methods for integrations.

| Value | Description |
|-------|-------------|
| `api_key` | API key authentication |
| `oauth2` | OAuth 2.0 authentication |

### SuggestionStatus
Status for service suggestions.

| Value | Description |
|-------|-------------|
| `pending` | Awaiting user decision |
| `accepted` | User accepted the suggestion |
| `rejected` | User rejected the suggestion |
| `ignored` | User chose to ignore |

---

## JSON Field Formats

### Alert/Incident Tags
```json
["database", "timeout", "critical", "payments"]
```

### Alert Labels
```json
{
  "env": "production",
  "region": "us-east-1",
  "team": "platform"
}
```

### Service Metadata
```json
{
  "oncall": "team-platform",
  "runbook": "https://wiki.example.com/api-gateway",
  "slack": "#api-alerts"
}
```

### Investigation Data Quality
```json
{
  "logs": 0.8,
  "code": 0.9,
  "metrics": 0.3,
  "github": 0.7
}
```

### Correlation Rule Match Criteria
```json
{
  "match": {
    "tags": ["database"],
    "severity": ["critical", "high"],
    "service": "user-service"
  }
}
```

### Postmortem Timeline
```json
[
  {
    "timestamp": "2024-01-15T10:30:00Z",
    "event": "Alert triggered",
    "impact": "API latency increased"
  },
  {
    "timestamp": "2024-01-15T10:35:00Z",
    "event": "Investigation started",
    "impact": null
  }
]
```

### Postmortem Action Items
```json
[
  {
    "title": "Add connection pool monitoring",
    "owner": "team-platform",
    "dueDate": "2024-02-01",
    "status": "pending"
  }
]
```

---

## Common Query Patterns

### Find active incidents
```sql
SELECT * FROM incidents
WHERE status NOT IN ('resolved', 'closed')
ORDER BY severity, priority, triggered_at DESC;
```

### Find alerts for an incident
```sql
SELECT * FROM alerts
WHERE incident_id = :incidentId
ORDER BY triggered_at DESC;
```

### Find recent investigations with agents
```sql
SELECT i.*, COUNT(ae.id) as agent_count
FROM investigations i
LEFT JOIN agent_executions ae ON ae.investigation_id = i.id
WHERE i.created_at > NOW() - INTERVAL '24 hours'
GROUP BY i.id
ORDER BY i.created_at DESC;
```

### Find tool execution summary
```sql
SELECT
  tool_name,
  tool_category,
  COUNT(*) as call_count,
  AVG(execution_time_ms) as avg_time_ms,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count
FROM tool_executions
WHERE executed_at > NOW() - INTERVAL '7 days'
GROUP BY tool_name, tool_category
ORDER BY call_count DESC;
```

---

## Edition Differences

### Community Edition
- Single organization (no multi-tenancy)
- No on-call schedules (AI workers handle everything)
- Simple user model: Owner + Members

### Enterprise Edition (Future)
- Add `organizationId` to key models
- Add `Schedule`, `EscalationPolicy` models
- Full RBAC for users
- SSO/SAML support
