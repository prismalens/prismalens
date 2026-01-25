---
name: change-correlation
description: Correlates incidents with recent changes (deployments, config, code) to identify change-induced issues. 60-90% of outages are caused by changes.
---

# Change Correlation Skill

## Purpose
Correlate the incident timing with recent changes to identify if a deployment, configuration change, or code change caused the issue. Industry data shows **60-90% of outages are caused by changes**.

## Why This Matters
- Most incidents are caused by something that changed recently
- Changes include: deployments, config updates, database migrations, feature flags
- Timing correlation is a strong signal for root cause

## Process

### 1. Establish Incident Timeline
- Exact time incident started (from alert/logs)
- Time of first user report (if available)
- Time of detection vs. actual start

### 2. Gather Recent Changes
Query the deployment-check capability for:
- Deployments in the last 24-48 hours
- Config changes (environment variables, feature flags)
- Database migrations
- Infrastructure changes (scaling, region changes)

### 3. Correlate Timing
For each change, calculate:
- Time delta: `change_time - incident_start_time`
- Risk factors:
  - **High risk**: Change within 2 hours before incident
  - **Medium risk**: Change within 24 hours before incident
  - **Low risk**: Change more than 24 hours before incident

### 4. Score Changes by Risk
| Factor | Score Modifier |
|--------|---------------|
| Deployed within 1 hour of incident | +30 |
| Contains database migration | +20 |
| Changes auth/security code | +20 |
| Config change (env vars) | +15 |
| First deploy of the day | +10 |
| Hotfix/emergency deploy | +10 |
| Routine maintenance | -10 |

## Output Format

Use the `correlate_with_changes` tool to record findings:

```json
{
  "incidentTime": "2024-01-15T14:30:00Z",
  "analyzedWindow": {
    "start": "2024-01-14T14:30:00Z",
    "end": "2024-01-15T14:30:00Z"
  },
  "correlatedChanges": [
    {
      "type": "deployment",
      "id": "deploy-abc123",
      "timestamp": "2024-01-15T14:15:00Z",
      "timeDelta": "-15 minutes",
      "riskScore": 85,
      "details": {
        "commit": "abc123",
        "message": "Fix user authentication flow",
        "author": "developer@example.com"
      },
      "riskFactors": [
        "Deployed within 1 hour of incident",
        "Changes auth/security code"
      ]
    },
    {
      "type": "config_change",
      "id": "config-def456",
      "timestamp": "2024-01-15T12:00:00Z",
      "timeDelta": "-2.5 hours",
      "riskScore": 45,
      "details": {
        "variable": "DATABASE_POOL_SIZE",
        "from": "10",
        "to": "5"
      },
      "riskFactors": [
        "Config change reducing resources"
      ]
    }
  ],
  "mostLikelyChange": {
    "id": "deploy-abc123",
    "confidence": 85,
    "reasoning": "Deployed 15 minutes before incident, modified authentication code which matches the error pattern"
  },
  "recommendation": "Investigate deploy-abc123 - the timing and code changes strongly correlate with the incident"
}
```

## Best Practices

1. **Always Check Changes First**: Before deep code analysis, check what changed recently
2. **Expand Window If Needed**: Some bugs manifest hours after deployment
3. **Check Rollbacks**: A recent rollback indicates a known issue
4. **Cross-Reference**: Match changed files with files in error stack trace
5. **Don't Assume**: Correlation is not causation - verify the hypothesis

## Integration with Other Skills

- **timeline-analysis**: Use to build comprehensive event timeline
- **pattern-correlation**: Cross-reference change patterns with error patterns
- **hypothesis-formation**: Use change correlation as evidence for hypothesis
