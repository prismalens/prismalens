---
name: config-change
description: Recommends configuration changes (environment variables, feature flags, thresholds) to resolve configuration-related incidents.
---

# Config Change Skill

## Purpose
Propose configuration changes when the incident root cause is a misconfiguration, wrong setting, or missing environment variable.

## Available Tools
- `propose_fix(recommendation)` - Submit a configuration change proposal

## Process

### 1. Identify Configuration Issue
From Detective's hypothesis:
- What setting is wrong?
- What is the current value?
- What should it be?

### 2. Locate Configuration Source
- Environment variables
- Config files (JSON, YAML, TOML)
- Feature flags
- Database settings
- Cloud provider settings

### 3. Design the Change
Consider:
- Impact scope (single service vs. all)
- Restart requirements
- Propagation time
- Validation

### 4. Document the Recommendation

## Output Format

Use `propose_fix` with:

```json
{
  "type": "config_change",
  "title": "Increase API timeout from 30s to 60s",
  "priority": "high",
  "description": "Current 30s timeout is insufficient for heavy queries, causing intermittent failures",
  "rootCauseLink": "Addresses hypothesis: timeout too aggressive for complex operations",
  "configChanges": [
    {
      "location": "environment",
      "variable": "API_TIMEOUT_MS",
      "currentValue": "30000",
      "newValue": "60000",
      "scope": "api-server service"
    }
  ],
  "implementation": {
    "method": "Render Dashboard → Environment → Edit API_TIMEOUT_MS",
    "restartRequired": true,
    "propagationTime": "Immediate after restart",
    "steps": [
      "Navigate to Render dashboard",
      "Select api-server service",
      "Go to Environment tab",
      "Update API_TIMEOUT_MS to 60000",
      "Click Save Changes",
      "Service will auto-restart"
    ]
  },
  "verification": {
    "steps": [
      "Wait for service restart to complete",
      "Check health endpoint",
      "Trigger a complex query that was failing",
      "Verify it completes without timeout"
    ],
    "successCriteria": "No timeout errors for complex queries"
  },
  "risks": [
    {
      "risk": "Longer timeouts may mask performance issues",
      "mitigation": "Add monitoring alert for queries > 30s"
    },
    {
      "risk": "May increase resource usage",
      "mitigation": "Monitor memory/CPU after change"
    }
  ],
  "rollbackPlan": "Revert API_TIMEOUT_MS to 30000 and restart"
}
```

## Configuration Types

### Environment Variables
```json
{
  "location": "environment",
  "variable": "DATABASE_POOL_SIZE",
  "currentValue": "10",
  "newValue": "25"
}
```

### Feature Flags
```json
{
  "location": "feature_flag",
  "flag": "new_auth_flow",
  "currentValue": true,
  "newValue": false,
  "platform": "LaunchDarkly|Statsig|internal"
}
```

### Config Files
```json
{
  "location": "file",
  "path": "config/production.json",
  "key": "cache.ttl",
  "currentValue": 300,
  "newValue": 600
}
```

### Threshold/Limit
```json
{
  "location": "environment",
  "variable": "MAX_REQUEST_SIZE_MB",
  "currentValue": "10",
  "newValue": "50",
  "unit": "megabytes"
}
```

## Common Config Issues

### Timeout Too Short
- Symptoms: Intermittent failures on slow operations
- Fix: Increase timeout value
- Consider: Why is it slow? Address root cause too

### Connection Pool Exhausted
- Symptoms: "Connection refused" or pool timeout errors
- Fix: Increase pool size
- Consider: Check for connection leaks first

### Memory Limit Hit
- Symptoms: OOM kills, restarts
- Fix: Increase memory limit
- Consider: Check for memory leaks first

### Missing Environment Variable
- Symptoms: "undefined" values, startup failures
- Fix: Add the missing variable
- Consider: Update documentation

### Wrong Environment
- Symptoms: Using test data in production
- Fix: Correct the environment-specific config
- Consider: Add environment validation

## Best Practices

1. **Document Current State**: Always note what the current value is
2. **Justify the Change**: Explain WHY the new value is better
3. **Scope Clearly**: Specify which services/environments affected
4. **Restart Awareness**: Note if restart is needed
5. **Monitoring**: Suggest what to watch after the change
6. **Reversibility**: Ensure change can be easily reverted
7. **Security**: Never include secrets in the proposal (reference them)
