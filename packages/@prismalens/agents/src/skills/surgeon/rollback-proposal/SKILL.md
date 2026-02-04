---
name: rollback-proposal
description: Recommends deployment rollbacks when a recent deployment is identified as the root cause of an incident.
---

# Rollback Proposal Skill

## Purpose
Recommend rolling back to a previous known-good deployment when a recent deployment is the root cause of an incident.

## Available Tools
- `suggest_rollback(rollback)` - Submit a rollback recommendation

## Process

### 1. Verify Rollback is Appropriate
Rollback is recommended when:
- Recent deployment correlates with incident start
- Confident the deployment introduced the bug
- Quick mitigation is needed
- Code fix would take too long

### 2. Identify Target Version
From Gatherer's findings:
- Last known good deployment
- Deployment before the problematic one
- Verify it was stable

### 3. Assess Rollback Impact
Consider:
- Data migrations (can they be reversed?)
- API changes (will clients break?)
- Feature flags (can we disable instead?)
- Database schema changes

### 4. Document the Recommendation

## Output Format

Use `suggest_rollback` with:

```json
{
  "service": "api-server",
  "currentVersion": {
    "deployId": "deploy-123",
    "commit": "abc123def",
    "deployedAt": "2024-01-15T10:15:00Z"
  },
  "targetVersion": {
    "deployId": "deploy-122",
    "commit": "xyz789abc",
    "deployedAt": "2024-01-14T15:30:00Z"
  },
  "reasoning": "Deploy-123 introduced a null pointer bug in auth handler. Rollback to deploy-122 will restore the previous working auth code.",
  "impact": {
    "featuresLost": [
      "New auth flow improvements (non-critical)"
    ],
    "dataConsiderations": "No database migrations in deploy-123, safe to rollback",
    "apiCompatibility": "API unchanged, no client impact"
  },
  "rollbackSteps": [
    "Verify deploy-122 is available in Render",
    "Trigger rollback via Render dashboard or CLI",
    "Monitor health checks for 5 minutes",
    "Verify error rate returns to normal"
  ],
  "verificationSteps": [
    "Check /health endpoint returns 200",
    "Monitor error rate in logs",
    "Test auth flow manually",
    "Verify no NullPointerException in logs"
  ],
  "alternatives": [
    {
      "option": "Feature flag",
      "description": "Disable new auth flow via feature flag",
      "pros": "Keep other changes from deploy-123",
      "cons": "May not exist, requires deployment"
    },
    {
      "option": "Hotfix",
      "description": "Deploy quick fix for null check",
      "pros": "Preserves new features",
      "cons": "Risk of introducing new bugs under pressure"
    }
  ],
  "urgency": "immediate|within_hour|within_day",
  "confidence": 90
}
```

## When NOT to Rollback

### Data Migrations
If the deployment included:
- Database schema changes that can't be reversed
- Data transformations that are one-way
- **Action**: Consider feature flags or hotfix instead

### API Breaking Changes
If clients depend on new API:
- Rolling back breaks integrations
- **Action**: Communicate with affected parties first

### Multiple Deployments
If multiple deployments happened:
- Determine which one caused the issue
- May need to rollback multiple versions

### Insufficient History
If target version is unknown:
- Don't guess
- **Action**: Investigate deployment history first

## Urgency Guidelines

| Urgency | Criteria |
|---------|----------|
| immediate | Production down, active data loss, security breach |
| within_hour | Major feature broken, significant revenue impact |
| within_day | Degraded service, workaround exists |

## Best Practices

1. **Verify Target**: Ensure target version was actually stable
2. **Check Migrations**: Database changes complicate rollbacks
3. **Communication**: Note who needs to be informed
4. **Monitoring**: Emphasize post-rollback verification
5. **Document**: Record why rollback was chosen over fix
6. **Temporary**: Rollback is mitigation, not permanent solution
