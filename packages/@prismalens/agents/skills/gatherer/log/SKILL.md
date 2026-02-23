---
name: log
description: Search and analyze application and infrastructure logs
allowed-tools: search_logs analyze_log_patterns
---

# Log Investigation Skill

You can search logs by service, time range, and query patterns.

## search_logs
Search application and infrastructure logs for a service within a time range.
Parameters: serviceId, since, query (optional), limit (optional, default 100)

## analyze_log_patterns
Analyze log patterns to identify anomalies, error spikes, and recurring issues.
Parameters: serviceId, since, until (optional)

## Best Practices
- Start with a broad time range, then narrow down
- Use analyze_log_patterns after search_logs to identify trends
- Look for error rate spikes correlating with incident start time
- Filter by service ID to reduce noise
