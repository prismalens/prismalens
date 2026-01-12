# API Reference

Complete API documentation for PrismaLens.

## Overview

PrismaLens uses oRPC (OpenAPI-compatible RPC) for type-safe API calls between the frontend and backend. All endpoints are prefixed with `/api/`.

## Authentication

PrismaLens uses better-auth for session-based authentication.

### Session Authentication

All API requests (except public endpoints) require an authenticated session.

```http
Cookie: prismalens.session_token=<session_token>
```

### Public Endpoints

These endpoints do not require authentication:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /api/auth/*` | Authentication endpoints |
| `POST /api/webhooks/*` | Webhook ingestion |
| `GET /api/setup/status` | Setup status check |

---

## Response Format

All responses follow a consistent format:

### Success Response

```json
{
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Not authorized for action |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `CONFLICT` | 409 | Resource already exists |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Authentication Endpoints

### Sign Up (Create Account)

```http
POST /api/auth/sign-up
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response**: Session cookie set automatically

### Sign In

```http
POST /api/auth/sign-in
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response**: Session cookie set automatically

### Sign Out

```http
POST /api/auth/sign-out
```

### Get Session

```http
GET /api/auth/session
```

**Response**:
```json
{
  "user": {
    "id": "usr_123",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "owner"
  },
  "session": {
    "id": "ses_123",
    "expiresAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## Alerts

### List Alerts

```http
GET /api/alerts?status=firing&service=api-gateway&limit=20&offset=0
```

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (firing, acknowledged, resolved) |
| `service` | string | Filter by service ID |
| `severity` | string | Filter by severity (critical, high, medium, low) |
| `startTime` | datetime | Filter by start time |
| `endTime` | datetime | Filter by end time |
| `limit` | number | Page size (default: 20, max: 100) |
| `offset` | number | Offset for pagination |

**Response**:
```json
{
  "data": [
    {
      "id": "alt_123",
      "title": "High CPU usage",
      "description": "CPU usage exceeded 90% for 5 minutes",
      "status": "firing",
      "severity": "critical",
      "source": "prometheus",
      "service": {
        "id": "svc_123",
        "name": "api-gateway"
      },
      "labels": {
        "instance": "api-gateway-1",
        "job": "kubernetes-pods"
      },
      "incidentId": "inc_42",
      "firedAt": "2026-01-12T12:42:00Z",
      "resolvedAt": null,
      "createdAt": "2026-01-12T12:42:00Z"
    }
  ],
  "meta": {
    "total": 156,
    "page": 1,
    "pageSize": 20
  }
}
```

### Get Alert

```http
GET /api/alerts/:id
```

### Acknowledge Alert

```http
POST /api/alerts/:id/acknowledge
Content-Type: application/json

{
  "note": "Investigating the issue"
}
```

---

## Incidents

### List Incidents

```http
GET /api/incidents?status=triggered&severity=critical&limit=20
```

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `severity` | string | Filter by severity |
| `service` | string | Filter by service ID |
| `assignee` | string | Filter by assignee user ID |
| `limit` | number | Page size |
| `offset` | number | Offset |

**Response**:
```json
{
  "data": [
    {
      "id": "inc_42",
      "title": "High CPU usage on api-gateway",
      "description": "Multiple alerts indicate elevated CPU usage",
      "status": "investigating",
      "severity": "critical",
      "service": {
        "id": "svc_123",
        "name": "api-gateway",
        "tier": 1
      },
      "alertCount": 3,
      "assignee": {
        "id": "usr_123",
        "name": "John Doe"
      },
      "investigation": {
        "id": "inv_123",
        "status": "analyzing",
        "progress": 75
      },
      "acknowledgedAt": "2026-01-12T12:43:00Z",
      "acknowledgedBy": {
        "id": "usr_123",
        "name": "John Doe"
      },
      "createdAt": "2026-01-12T12:42:00Z",
      "updatedAt": "2026-01-12T12:50:00Z"
    }
  ],
  "meta": {
    "total": 12,
    "page": 1,
    "pageSize": 20
  }
}
```

### Get Incident

```http
GET /api/incidents/:id
```

### Get Incident Statistics

```http
GET /api/incidents/stats
```

**Response**:
```json
{
  "active": 12,
  "investigating": 3,
  "resolvedToday": 8,
  "mttr": 23,
  "mttrChange": -12,
  "bySeverity": {
    "critical": 2,
    "high": 5,
    "medium": 3,
    "low": 2
  }
}
```

### Create Incident (Manual)

```http
POST /api/incidents
Content-Type: application/json

{
  "title": "Service degradation",
  "description": "Users reporting slow response times",
  "severity": "high",
  "serviceId": "svc_123"
}
```

### Update Incident

```http
PATCH /api/incidents/:id
Content-Type: application/json

{
  "status": "identified",
  "severity": "medium",
  "assigneeId": "usr_456"
}
```

### Acknowledge Incident

```http
POST /api/incidents/:id/acknowledge
Content-Type: application/json

{
  "note": "Looking into this now"
}
```

### Resolve Incident

```http
POST /api/incidents/:id/resolve
Content-Type: application/json

{
  "resolution": "Deployed fix for N+1 query",
  "rootCause": "N+1 query in UserService.getUsers()"
}
```

### Get Incident Timeline

```http
GET /api/incidents/:id/timeline
```

**Response**:
```json
{
  "data": [
    {
      "id": "tle_1",
      "type": "incident_created",
      "message": "Incident created from 3 alerts",
      "timestamp": "2026-01-12T12:42:00Z"
    },
    {
      "id": "tle_2",
      "type": "acknowledged",
      "message": "Acknowledged by John Doe",
      "user": {
        "id": "usr_123",
        "name": "John Doe"
      },
      "timestamp": "2026-01-12T12:43:00Z"
    },
    {
      "id": "tle_3",
      "type": "investigation_started",
      "message": "AI investigation started",
      "timestamp": "2026-01-12T12:43:30Z"
    }
  ]
}
```

### Get/Update Postmortem

```http
GET /api/incidents/:id/postmortem
```

```http
POST /api/incidents/:id/postmortem
Content-Type: application/json

{
  "summary": "N+1 query caused database connection exhaustion",
  "rootCause": "Missing eager loading in UserService",
  "timeline": "...",
  "actionItems": [
    {
      "title": "Add N+1 query detection to CI",
      "assigneeId": "usr_456",
      "dueDate": "2026-01-19"
    }
  ],
  "lessonsLearned": "Need better database query monitoring"
}
```

---

## Investigations

### List Investigations

```http
GET /api/investigations?status=active
```

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (active, completed, failed) |
| `incidentId` | string | Filter by incident |
| `limit` | number | Page size |
| `offset` | number | Offset |

### Get Investigation

```http
GET /api/investigations/:id
```

**Response**:
```json
{
  "id": "inv_123",
  "incidentId": "inc_42",
  "status": "analyzing",
  "progress": 75,
  "startedAt": "2026-01-12T12:43:30Z",
  "completedAt": null,
  "rootCause": null,
  "confidence": null,
  "toolsUsed": ["fetch_logs", "search_code", "get_metrics"],
  "createdAt": "2026-01-12T12:43:30Z"
}
```

### Get Investigation Graph (LangGraph State)

```http
GET /api/investigations/:id/graph
```

**Response**:
```json
{
  "nodes": [
    {
      "id": "node_1",
      "type": "start",
      "label": "Start",
      "status": "completed",
      "metadata": {}
    },
    {
      "id": "node_2",
      "type": "gather_context",
      "label": "Gather Context",
      "status": "completed",
      "metadata": {
        "toolsCalled": ["fetch_logs", "get_metrics"],
        "duration": 5200
      }
    },
    {
      "id": "node_3",
      "type": "analyze",
      "label": "Analyze",
      "status": "running",
      "metadata": {
        "progress": 60
      }
    }
  ],
  "edges": [
    { "source": "node_1", "target": "node_2" },
    { "source": "node_2", "target": "node_3" }
  ],
  "currentNode": "node_3"
}
```

### Start Investigation (Manual)

```http
POST /api/investigations
Content-Type: application/json

{
  "incidentId": "inc_42"
}
```

### Approve Investigation Gate

```http
POST /api/investigations/:id/approve
Content-Type: application/json

{
  "approved": true,
  "note": "Looks good, proceed with recommendations"
}
```

### Retry Investigation from Node

```http
POST /api/investigations/:id/retry
Content-Type: application/json

{
  "fromNodeId": "node_2",
  "reason": "Additional context needed"
}
```

---

## Recommendations

### List Recommendations

```http
GET /api/recommendations?status=pending&incidentId=inc_42
```

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (pending, applied, dismissed) |
| `incidentId` | string | Filter by incident |
| `type` | string | Filter by type (code, config, runbook) |

**Response**:
```json
{
  "data": [
    {
      "id": "rec_123",
      "investigationId": "inv_123",
      "incidentId": "inc_42",
      "type": "code",
      "title": "Add eager loading to prevent N+1 query",
      "description": "The UserService.getUsers() method is causing N+1 queries...",
      "confidence": 92,
      "status": "pending",
      "codeChange": {
        "file": "src/services/UserService.ts",
        "line": 45,
        "before": "return this.userRepo.find()",
        "after": "return this.userRepo.find({ relations: ['profile', 'settings'] })"
      },
      "createdAt": "2026-01-12T12:55:00Z"
    }
  ]
}
```

### Get Recommendation

```http
GET /api/recommendations/:id
```

### Apply Recommendation

```http
POST /api/recommendations/:id/apply
Content-Type: application/json

{
  "note": "Applied via PR #123"
}
```

### Dismiss Recommendation

```http
POST /api/recommendations/:id/dismiss
Content-Type: application/json

{
  "reason": "Not applicable to our setup"
}
```

---

## Services

### List Services

```http
GET /api/services?tier=1&type=service
```

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `tier` | number | Filter by tier (1-4) |
| `type` | string | Filter by type |
| `team` | string | Filter by team |

**Response**:
```json
{
  "data": [
    {
      "id": "svc_123",
      "name": "api-gateway",
      "displayName": "API Gateway",
      "description": "Main API gateway for public endpoints",
      "type": "gateway",
      "tier": 1,
      "team": "platform",
      "repository": "org/api-gateway",
      "activeIncidents": 1,
      "integrations": [
        { "type": "github", "status": "connected" },
        { "type": "prometheus", "status": "connected" }
      ],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

### Get Service

```http
GET /api/services/:id
```

### Create Service

```http
POST /api/services
Content-Type: application/json

{
  "name": "user-service",
  "displayName": "User Service",
  "description": "Handles user authentication and profiles",
  "type": "service",
  "tier": 2,
  "team": "backend",
  "repository": "org/user-service"
}
```

### Update Service

```http
PATCH /api/services/:id
Content-Type: application/json

{
  "tier": 1,
  "investigationPolicy": {
    "autoInvestigate": "always",
    "humanApprovalGate": true
  }
}
```

### Delete Service

```http
DELETE /api/services/:id
```

### Get Service Dependencies

```http
GET /api/services/:id/dependencies
```

**Response**:
```json
{
  "upstream": [],
  "downstream": [
    {
      "id": "svc_456",
      "name": "user-service",
      "type": "service",
      "tier": 2,
      "impact": "critical_path"
    }
  ]
}
```

### Add Service Dependency

```http
POST /api/services/:id/dependencies
Content-Type: application/json

{
  "dependsOnId": "svc_456",
  "impact": "critical_path"
}
```

### Get Service Integrations

```http
GET /api/services/:id/integrations
```

### Add Service Integration

```http
POST /api/services/:id/integrations
Content-Type: application/json

{
  "connectionId": "conn_123"
}
```

---

## Integrations

### List Integration Definitions

```http
GET /api/integrations
```

**Response**:
```json
{
  "data": [
    {
      "id": "github",
      "name": "GitHub",
      "category": "code",
      "authMethods": ["oauth", "token"],
      "description": "Connect to GitHub for code context"
    },
    {
      "id": "prometheus",
      "name": "Prometheus",
      "category": "metrics",
      "authMethods": ["api_key", "webhook"],
      "description": "Receive alerts from Prometheus"
    }
  ]
}
```

### List Connections

```http
GET /api/integrations/connections?global=true
```

### Create Connection

```http
POST /api/integrations/connections
Content-Type: application/json

{
  "integrationId": "github",
  "name": "Production GitHub",
  "authMethod": "token",
  "credentials": {
    "token": "ghp_xxxxxxxxxxxx"
  },
  "config": {
    "organization": "acme-corp"
  },
  "global": true
}
```

### Test Connection

```http
POST /api/integrations/connections/:id/test
```

**Response**:
```json
{
  "success": true,
  "message": "Successfully connected to GitHub",
  "details": {
    "organization": "acme-corp",
    "repositories": 42
  }
}
```

### Delete Connection

```http
DELETE /api/integrations/connections/:id
```

### OAuth Flow

```http
GET /api/oauth/:provider/authorize?redirect=/settings/integrations
```

Redirects to provider's OAuth authorization page. After authorization, redirects back to:

```http
GET /api/oauth/:provider/callback?code=xxx&state=xxx
```

---

## Webhooks

### Generic Webhook

```http
POST /api/webhooks/generic
Content-Type: application/json

{
  "title": "Alert Title",
  "description": "Alert description",
  "severity": "high",
  "source": "custom-monitor",
  "service": "api-gateway",
  "labels": {
    "environment": "production"
  }
}
```

### Prometheus AlertManager Webhook

```http
POST /api/webhooks/prometheus
Content-Type: application/json

{
  "receiver": "prismalens",
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HighCPU",
        "severity": "critical",
        "service": "api-gateway"
      },
      "annotations": {
        "summary": "High CPU usage detected",
        "description": "CPU usage is above 90%"
      },
      "startsAt": "2026-01-12T12:42:00Z"
    }
  ]
}
```

### GitHub Webhook

```http
POST /api/webhooks/github
X-GitHub-Event: workflow_run
X-Hub-Signature-256: sha256=xxx

{
  "action": "completed",
  "workflow_run": { ... }
}
```

---

## Settings

### Get All Settings

```http
GET /api/settings
```

### Update Settings

```http
PATCH /api/settings
Content-Type: application/json

{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o"
  },
  "investigation": {
    "maxConcurrent": 5,
    "timeout": 30
  }
}
```

### Get AI Configuration

```http
GET /api/settings/ai
```

### Update AI Configuration

```http
PATCH /api/settings/ai
Content-Type: application/json

{
  "provider": "google",
  "apiKey": "xxx",
  "model": "gemini-2.0-flash-exp"
}
```

### Test AI Connection

```http
POST /api/settings/ai/test
```

**Response**:
```json
{
  "success": true,
  "provider": "google",
  "model": "gemini-2.0-flash-exp",
  "latency": 234
}
```

---

## Team

### List Team Members

```http
GET /api/team/members
```

**Response**:
```json
{
  "data": [
    {
      "id": "usr_123",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "owner",
      "joinedAt": "2026-01-01T00:00:00Z",
      "lastActiveAt": "2026-01-12T12:00:00Z"
    }
  ]
}
```

### Invite Member

```http
POST /api/team/invite
Content-Type: application/json

{
  "email": "alice@example.com",
  "role": "member"
}
```

### Update Member Role

```http
PATCH /api/team/members/:id/role
Content-Type: application/json

{
  "role": "admin"
}
```

### Remove Member

```http
DELETE /api/team/members/:id
```

---

## Correlation Rules

### List Correlation Rules

```http
GET /api/correlation-rules
```

### Create Correlation Rule

```http
POST /api/correlation-rules
Content-Type: application/json

{
  "name": "Same Service, Same Hour",
  "description": "Group alerts from same service within 60 minutes",
  "priority": 1,
  "enabled": true,
  "conditions": {
    "matchType": "all",
    "rules": [
      { "field": "service", "operator": "equals", "value": "$existing.service" },
      { "field": "timestamp", "operator": "within", "value": "60m" }
    ]
  },
  "action": "correlate"
}
```

### Update Correlation Rule

```http
PATCH /api/correlation-rules/:id
Content-Type: application/json

{
  "enabled": false
}
```

### Delete Correlation Rule

```http
DELETE /api/correlation-rules/:id
```

---

## Alert Mapping Rules

### List Mapping Rules

```http
GET /api/alert-mapping-rules
```

### Create Mapping Rule

```http
POST /api/alert-mapping-rules
Content-Type: application/json

{
  "name": "Map Kubernetes namespace to service",
  "priority": 1,
  "enabled": true,
  "conditions": {
    "labelMatch": {
      "namespace": "production"
    }
  },
  "mapping": {
    "serviceField": "labels.app"
  }
}
```

---

## Health Check

```http
GET /health
```

**Response**:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected",
  "timestamp": "2026-01-12T12:42:00Z"
}
```

---

## Rate Limiting

API endpoints are rate limited to prevent abuse:

| Endpoint Category | Rate Limit |
|------------------|------------|
| Authentication | 10 requests/minute |
| Webhooks | 1000 requests/minute |
| Read operations | 100 requests/minute |
| Write operations | 50 requests/minute |

Rate limit headers are included in responses:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1736685720
```

---

## WebSocket Events

Connect to `/api/ws` for real-time updates.

### Event Types

| Event | Description |
|-------|-------------|
| `incident:created` | New incident created |
| `incident:updated` | Incident status changed |
| `alert:received` | New alert received |
| `investigation:progress` | Investigation progress update |
| `investigation:completed` | Investigation finished |
| `recommendation:created` | New recommendation available |

### Example Event

```json
{
  "type": "investigation:progress",
  "data": {
    "investigationId": "inv_123",
    "incidentId": "inc_42",
    "progress": 75,
    "currentNode": "analyze",
    "message": "Analyzing collected data..."
  },
  "timestamp": "2026-01-12T12:50:00Z"
}
```

---

## Related Documentation

- [Installation](./01_Installation.md) - Environment setup
- [Alerts](./04_Alerts.md) - Alert ingestion
- [Incidents](./05_Incidents.md) - Incident management
- [Investigations](./06_Investigations.md) - AI investigations
- [Services](./07_Services.md) - Service configuration
