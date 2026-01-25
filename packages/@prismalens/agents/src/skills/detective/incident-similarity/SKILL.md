---
name: incident-similarity
description: Finds historically similar incidents to leverage past resolutions and patterns. Based on BigPanda's 30% similarity threshold pattern.
---

# Incident Similarity Skill

## Purpose
Find incidents from the past that are similar to the current one. This helps:
- Identify recurring issues
- Leverage past resolutions
- Spot systemic problems
- Reduce MTTR by applying known fixes

## Why This Matters
- Many incidents are recurring - same root cause, different symptoms
- Past resolutions can be applied quickly
- Similar incidents across services may indicate infrastructure issues
- Historical patterns help prioritize investigation

## Similarity Criteria

### High-Weight Factors (40% of score)
- **Error message match**: Same or similar error text
- **Service name**: Same service affected
- **Root cause category**: code/config/infrastructure/external

### Medium-Weight Factors (35% of score)
- **Affected files**: Overlapping files in error traces
- **Time patterns**: Same time of day/week (cron jobs, traffic patterns)
- **Severity level**: Similar severity

### Low-Weight Factors (25% of score)
- **Alert count**: Similar number of correlated alerts
- **Resolution type**: Same fix category
- **Author/team**: Same team's code involved

## Similarity Threshold
Based on industry patterns (BigPanda uses 30%):
- **70%+**: Strong match - very likely same issue
- **50-69%**: Moderate match - worth investigating
- **30-49%**: Weak match - possible patterns
- **Below 30%**: Not similar enough to consider

## Process

### 1. Extract Incident Fingerprint
From current incident, extract:
- Error message patterns (normalized)
- Service name
- Affected files/functions
- Severity level
- Time characteristics

### 2. Query Historical Incidents
Search incidents from:
- Last 30 days (primary window)
- Last 90 days (extended search if few matches)
- Same service/team

### 3. Calculate Similarity Scores
For each historical incident:
- Compare fingerprints
- Weight factors appropriately
- Calculate overall similarity score

### 4. Rank and Return Top Matches
Return top 5 similar incidents sorted by:
- Similarity score (primary)
- Recency (secondary)
- Resolution quality (tertiary)

## Output Format

Use the `find_similar_incidents` tool to record findings:

```json
{
  "currentIncident": {
    "id": "INC-456",
    "fingerprint": {
      "errorPattern": "NullPointerException in UserService",
      "service": "api-gateway",
      "severity": "high",
      "category": "code"
    }
  },
  "searchWindow": {
    "start": "2023-12-15T00:00:00Z",
    "end": "2024-01-15T00:00:00Z"
  },
  "similarIncidents": [
    {
      "incidentId": "INC-234",
      "date": "2024-01-10T09:15:00Z",
      "similarity": 85,
      "title": "NullPointerException in user lookup",
      "service": "api-gateway",
      "matchingFactors": [
        "Same error pattern",
        "Same service",
        "Same code path"
      ],
      "resolution": {
        "type": "code_fix",
        "summary": "Added null check in UserService.getUser()",
        "timeToResolve": "45 minutes",
        "fixCommit": "abc123"
      },
      "wasRecurring": true
    },
    {
      "incidentId": "INC-189",
      "date": "2024-01-05T14:30:00Z",
      "similarity": 62,
      "title": "User authentication failures",
      "service": "api-gateway",
      "matchingFactors": [
        "Same service",
        "Similar error category"
      ],
      "resolution": {
        "type": "config_change",
        "summary": "Increased database connection pool",
        "timeToResolve": "20 minutes"
      },
      "wasRecurring": false
    }
  ],
  "patterns": [
    {
      "observation": "3 similar incidents in past 30 days",
      "suggestion": "This may be a recurring issue - consider permanent fix"
    }
  ],
  "recommendedAction": "Review fix from INC-234 - 85% similarity, resolved with code fix to UserService"
}
```

## Best Practices

1. **Start with High Similarity**: Focus on 70%+ matches first
2. **Check Resolution Quality**: Verify past fixes actually worked
3. **Note Recurring Issues**: Multiple similar incidents = systemic problem
4. **Consider Service Context**: Same error in different services may have different causes
5. **Update After Resolution**: Add current incident to knowledge base

## Integration with Other Skills

- **hypothesis-formation**: Use similar incidents as evidence
- **change-correlation**: Past incident may have been caused by similar change
- **pattern-correlation**: Combine with error patterns for stronger signal
