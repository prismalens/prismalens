---
name: deployment-check
description: Checks deployment status, health, and recent deployment history to identify deployment-related issues.
capability: deployment-check
integrations:
  - render
  - kubernetes
  - aws-ecs
  - heroku
  - vercel
---

# Deployment Check Skill

## Purpose
Verify deployment status, health checks, and recent deployment history to identify if the incident is related to deployment changes.

## Capability-Based Tools
This skill uses the **deployment-check** capability which automatically resolves to the appropriate integration:

| Integration | Tools Available |
|-------------|-----------------|
| Render | `render_list_services`, `render_list_deploys`, `render_get_deploy` |
| Kubernetes | `k8s_get_pods`, `k8s_describe_deployment`, `k8s_get_events` |
| AWS ECS | `ecs_describe_services`, `ecs_list_tasks`, `ecs_describe_task` |
| Heroku | `heroku_releases`, `heroku_dyno_status` |
| Vercel | `vercel_list_deployments`, `vercel_get_deployment` |

The system automatically selects tools based on the configured integration. You don't need to choose which one to use - just describe what you need.

## Process

### 1. Current Status Check
- Verify service is running
- Check health endpoint status
- Review resource utilization

### 2. Recent Deployments
- List deployments in last 24-48 hours
- Identify any failed deployments
- Note successful deployments close to incident time

### 3. Deployment Correlation
- Compare incident start time with deployment times
- Check for config changes in recent deploys
- Review environment variable changes

### 4. Health Analysis
- Check if health checks are failing
- Review restart frequency
- Note any scaling events

## Output Format

Return findings as structured summary:

```json
{
  "currentStatus": {
    "state": "running|deploying|failed",
    "healthCheck": "passing|failing|unknown",
    "lastHealthy": "ISO timestamp",
    "uptime": "2h 15m"
  },
  "recentDeployments": [
    {
      "id": "deploy-123",
      "status": "live|failed|rolled_back",
      "createdAt": "ISO timestamp",
      "commit": "abc123",
      "commitMessage": "Fixed user auth",
      "triggeredBy": "manual|auto"
    }
  ],
  "suspiciousDeployment": {
    "id": "deploy-122",
    "reason": "Deployed 5 minutes before incident started",
    "changes": ["Updated auth middleware", "Changed timeout config"]
  },
  "resourceUtilization": {
    "cpu": "75%",
    "memory": "85%",
    "disk": "45%"
  },
  "restartHistory": [
    {
      "timestamp": "ISO timestamp",
      "reason": "OOM killed",
      "count": 3
    }
  ],
  "confidence": 80
}
```

## Best Practices

1. **Timeline Focus**: Prioritize deployments near incident time
2. **Check Rollbacks**: A rollback may indicate a known issue
3. **Environment Changes**: Config changes can cause subtle bugs
4. **Resource Spikes**: Check if deployment caused resource issues
5. **Correlate Commits**: Match deployment commits with code changes
