---
name: runbook-lookup
description: Searches runbooks and documentation for relevant remediation steps and past solutions.
---

# Runbook Lookup Skill

## Purpose
Find relevant runbooks, documentation, and past remediation procedures to accelerate incident resolution. Leverage organizational knowledge to apply proven fixes.

## Why This Matters
- **Faster MTTR**: Don't reinvent solutions - use what worked before
- **Consistency**: Apply standard procedures across similar incidents
- **Knowledge Transfer**: Capture and reuse tribal knowledge
- **Compliance**: Follow documented change procedures

## Available Tools
- `lookup_runbook(query, category?)` - Search runbooks for remediation steps

## Process

### 1. Extract Search Terms
From Detective's hypothesis:
- Root cause category (code/config/infrastructure/external)
- Affected service or component
- Error type or symptom keywords
- Related technologies

### 2. Search Runbooks
Query sources in priority order:
1. **Service-specific runbooks** - `{service-name}/runbook.md`
2. **Category runbooks** - `runbooks/{category}/`
3. **General procedures** - `docs/operations/`
4. **Past incident postmortems** - `postmortems/`

### 3. Match and Rank Results
Score results by:
- **Keyword relevance** (40%) - How well terms match
- **Service match** (30%) - Same service affected
- **Recency** (20%) - More recent = more relevant
- **Success rate** (10%) - Was this fix effective before?

### 4. Extract Actionable Steps
From matched runbooks:
- Prerequisites and safety checks
- Step-by-step remediation
- Verification steps
- Rollback procedure

## Output Format

Use `lookup_runbook` tool:

```json
{
  "query": "database connection timeout postgres",
  "category": "infrastructure",
  "results": [
    {
      "title": "PostgreSQL Connection Timeout Troubleshooting",
      "source": "runbooks/database/postgres-connections.md",
      "relevance": 95,
      "summary": "Steps to diagnose and fix connection pool exhaustion",
      "sections": [
        {
          "name": "Diagnosis",
          "steps": [
            "Check current connections: SELECT count(*) FROM pg_stat_activity",
            "Identify long-running queries: SELECT * FROM pg_stat_activity WHERE state = 'active'",
            "Check pool configuration in DATABASE_POOL_SIZE env var"
          ]
        },
        {
          "name": "Remediation",
          "steps": [
            "Kill idle connections: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '1 hour'",
            "Increase pool size if consistently near limit",
            "Add connection timeout to application config"
          ]
        },
        {
          "name": "Verification",
          "steps": [
            "Monitor connection count for 5 minutes",
            "Verify application health checks pass",
            "Check error rate in metrics"
          ]
        }
      ],
      "lastUsed": "2024-01-10T14:30:00Z",
      "successRate": "87%"
    }
  ],
  "recommendedAction": "Follow PostgreSQL Connection Timeout Troubleshooting runbook - 95% relevance, 87% historical success rate"
}
```

## Runbook Categories

| Category | Examples |
|----------|----------|
| database | Connection issues, query performance, replication |
| network | DNS, load balancer, firewall, SSL/TLS |
| compute | CPU, memory, disk, scaling |
| application | Crashes, memory leaks, deadlocks |
| external | API failures, third-party outages |
| security | Auth failures, certificate issues |

## Search Strategies

### Symptom-Based Search
```
"high latency" + service_name + "response time"
```

### Error-Based Search
```
"NullPointerException" + "authentication" + "handler"
```

### Component-Based Search
```
"redis" + "connection refused" + "cache"
```

### Time-Pattern Search
```
"cron job" + "midnight" + "timeout"
```

## Integration with Other Skills

- **code-fix**: Runbook may reference specific code patterns to fix
- **config-change**: Runbook may specify exact config values
- **rollback-proposal**: Runbook may have rollback procedures
- **risk-assessment**: Use runbook success rate in risk calculation

## Best Practices

1. **Start Broad, Narrow Down**: Begin with general terms, refine based on results
2. **Check Multiple Sources**: Don't stop at first match
3. **Verify Currency**: Check last update date - old runbooks may be outdated
4. **Adapt to Context**: Runbook steps may need adjustment for current situation
5. **Document Gaps**: If no runbook exists, flag for future creation
6. **Update After Resolution**: Improve runbook with lessons learned
