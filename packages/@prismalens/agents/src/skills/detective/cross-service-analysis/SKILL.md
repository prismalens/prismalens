---
name: cross-service-analysis
description: Analyzes errors across multiple services to find cascade origins in distributed systems. Uses service topology and MCP tools.
---

# Cross-Service Analysis Skill

## Purpose
In distributed systems, one service failure cascades to others. OpenTelemetry shows errors for ALL services, but we need to find the ORIGIN - the first domino that fell.

## Available MCP Tools
- `mcp_search_pattern(pattern, directory, fileType)` - Search within a service's codebase
- `mcp_get_callers(functionName, depth)` - Trace call paths within a service
- `mcp_search_code_advanced(query, regex, filePattern)` - Find patterns across code
- `mcp_get_file_summary(filePath)` - Understand service structure

## The Cascade Problem

```
Service A (API Gateway)    Service B (Auth)    Service C (Database)
        │                        │                      │
   "500 Error"              "Auth failed"        "Connection refused"
        │                        │                      │
        └────────────────────────┴──────────────────────┘
                                 │
                    All three report errors!
                    But only C is the actual root cause
```

## Process

### 1. Gather Service Topology
From PrismaLens:
- List all services affected by the incident
- Get their dependency relationships (upstream/downstream)
- Get their associated repositories/code paths

### 2. Map Error Timeline
For each affected service:
- Get first error timestamp
- Categorize error type
- Note if it's primary (thrown) or secondary (propagated)

### 3. Identify Service Boundaries
Look for:
- HTTP/gRPC client calls
- Message queue producers/consumers
- Database connection points
- Shared cache access

### 4. Analyze Each Service's Error
For each service's codebase:
```
# Find where errors are caught from external calls
pattern: "(axios|fetch|grpc).*catch"

# Find where service calls out
pattern: "(axios|fetch).*(serviceName|/api/)"

# Find retry logic
pattern: "retry|backoff|attempt"
```

### 5. Correlate Across Services
Build a dependency timeline:
- Which service errored first?
- Which services call that service?
- Does error propagation match the call chain?

## Output Format

```json
{
  "affectedServices": [
    {
      "name": "api-gateway",
      "repo": "github.com/org/api-gateway",
      "firstError": "2024-01-15T10:23:45Z",
      "errorType": "upstream_failure",
      "errorMessage": "Auth service unavailable"
    },
    {
      "name": "auth-service",
      "repo": "github.com/org/auth-service",
      "firstError": "2024-01-15T10:23:42Z",
      "errorType": "upstream_failure",
      "errorMessage": "Database connection failed"
    },
    {
      "name": "user-db",
      "repo": "github.com/org/user-db",
      "firstError": "2024-01-15T10:23:40Z",
      "errorType": "primary",
      "errorMessage": "ECONNREFUSED"
    }
  ],
  "cascadeChain": [
    {
      "from": "user-db",
      "to": "auth-service",
      "mechanism": "database connection",
      "delay": "2 seconds"
    },
    {
      "from": "auth-service",
      "to": "api-gateway",
      "mechanism": "HTTP call",
      "delay": "3 seconds"
    }
  ],
  "originatingService": {
    "name": "user-db",
    "confidence": 95,
    "evidence": [
      "First to report error (10:23:40Z)",
      "ECONNREFUSED is a primary error, not propagated",
      "Other services wait for this service"
    ]
  },
  "codeAnalysis": {
    "user-db": {
      "errorLocation": "src/db/pool.ts:45",
      "likelyCause": "Connection pool exhausted or DB offline",
      "relevantCode": [
        {
          "file": "src/db/pool.ts",
          "function": "getConnection",
          "issue": "No connection timeout configured"
        }
      ]
    }
  },
  "recommendations": [
    "Add connection timeout to user-db pool configuration",
    "Add circuit breaker in auth-service for DB calls",
    "Add better error messages showing actual DB error"
  ]
}
```

## Service Call Pattern Detection

### HTTP Clients
```
# Find outgoing HTTP calls
pattern: "axios\.(get|post|put)|fetch\(|http\.(get|post)"
```

### gRPC Clients
```
pattern: "grpc\.|\.rpc\.|client\.(call|invoke)"
```

### Database Clients
```
pattern: "prisma\.|sequelize\.|mongoose\.|pool\.(query|connect)"
```

### Message Queues
```
pattern: "kafka\.|rabbitmq\.|sqs\.|pubsub\."
```

## Cascade Analysis Checklist

1. **Timestamp Order**
   - [ ] Which service errored first?
   - [ ] Does error timing match call latencies?

2. **Error Types**
   - [ ] Which errors are primary (thrown)?
   - [ ] Which errors are propagated (caught from calls)?

3. **Retry Behavior**
   - [ ] Are retries amplifying the cascade?
   - [ ] Are circuit breakers tripping?

4. **Resource Exhaustion**
   - [ ] Connection pool exhaustion?
   - [ ] Thread/goroutine exhaustion?
   - [ ] Memory pressure?

## Best Practices

1. **Time is Truth**: The first error timestamp often points to origin
2. **Follow Dependencies**: Errors flow downstream, causes are upstream
3. **Check Timeouts**: Timeout errors usually mean upstream is struggling
4. **Look for Retries**: Excessive retries can mask the real first failure
5. **Primary vs Secondary**: "Connection refused" is primary, "Service unavailable" is secondary
