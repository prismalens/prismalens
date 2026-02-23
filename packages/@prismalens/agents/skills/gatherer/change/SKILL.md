---
name: change
description: Track code changes and deployment history
allowed-tools: get_recent_commits get_deployment_history
metadata:
  requiredIntegrations: github gitlab
---

# Change Tracking Skill

Track recent code changes and deployment history to correlate with incidents.

## get_recent_commits
Get recent git commits for a service, useful for correlating code changes with incidents.
Parameters: serviceId, since (ISO timestamp), limit (optional, default 20)

## get_deployment_history
Get recent deployments for a service, useful for identifying deployment-related issues.
Parameters: serviceId, limit (optional, default 5)

## Best Practices
- Check commits around the incident start time for suspicious changes
- Look for deployment events that correlate with alert triggers
- Cross-reference commit authors for escalation context
- Compare deployment versions before and after the incident window
