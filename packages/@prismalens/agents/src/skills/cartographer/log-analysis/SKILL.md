---
name: log-analysis
description: Fetches and analyzes logs from deployment/observability platforms to identify errors, warnings, and patterns relevant to the incident.
capability: log-analysis
integrations:
  - render
  - datadog
  - opentelemetry
  - cloudwatch
  - splunk
---

# Log Analysis Skill

## Purpose
Retrieve application logs from deployment/observability platforms to find errors and patterns relevant to the incident being investigated.

## Capability-Based Tools
This skill uses the **log-analysis** capability which automatically resolves to the appropriate integration:

| Integration | Tools Available |
|-------------|-----------------|
| Render | `render_get_logs`, `render_list_services` |
| Datadog | `datadog_query_logs`, `datadog_search_events` |
| OpenTelemetry | `otel_query_traces`, `otel_get_logs` |
| CloudWatch | `cloudwatch_get_logs`, `cloudwatch_filter_logs` |
| Splunk | `splunk_search`, `splunk_get_events` |

The system automatically selects tools based on the configured integration. You don't need to choose which one to use - just describe what you need.

## Process

### 1. Determine Time Range
- Use incident start time as reference
- Expand window: 30 minutes before to current time
- Adjust based on incident severity (critical = wider window)

### 2. Fetch Logs
- Start with error-level logs
- If sparse, include warnings
- Filter by service if known

### 3. Identify Patterns
- Group similar errors by message
- Note frequency and timing
- Flag first occurrence vs. subsequent

### 4. Extract Key Information
- Error messages with stack traces
- Timestamps (especially first occurrence)
- Request/response context if available
- Environment variables or config mentioned

## Output Format

Return findings as structured summary:

```json
{
  "timeRange": {
    "start": "ISO timestamp",
    "end": "ISO timestamp"
  },
  "keyErrors": [
    {
      "message": "Error text",
      "firstSeen": "ISO timestamp",
      "count": 15,
      "stackTrace": "if available",
      "severity": "error|warning"
    }
  ],
  "patterns": [
    {
      "description": "Pattern description",
      "evidence": ["log line 1", "log line 2"]
    }
  ],
  "anomalies": [
    "Unusual spike at 14:30",
    "No logs for 2 minutes at 14:25"
  ],
  "confidence": 85
}
```

## Best Practices

1. **Filter Early**: Use search queries to reduce log volume
2. **Timestamp Awareness**: Always include timestamps in output
3. **Don't Dump**: Extract relevant snippets, not entire logs
4. **Note Gaps**: Missing logs can be as informative as errors
5. **Correlate**: Look for patterns across multiple log lines
