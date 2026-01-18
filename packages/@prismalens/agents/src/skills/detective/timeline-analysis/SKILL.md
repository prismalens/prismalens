---
name: timeline-analysis
description: Builds a chronological timeline of events leading to and during the incident to identify causation chains.
---

# Timeline Analysis Skill

## Purpose
Construct a detailed chronological timeline of events to identify the sequence of actions and changes that led to the incident.

## Available Tools
- `form_hypothesis(hypothesis)` - Use to record timeline-based findings

## Process

### 1. Establish Key Timestamps
- **Incident Start**: When issue first manifested
- **Detection Time**: When alert fired / user reported
- **First Error**: Earliest error in logs
- **Last Known Good**: Most recent normal operation

### 2. Gather Timeline Events
From Cartographer's findings, extract:
- Deployments with timestamps
- Code commits and merges
- Configuration changes
- Error occurrences
- System events (restarts, scaling)
- External events (API changes, traffic spikes)

### 3. Build Causation Chain
Identify temporal relationships:
- What happened immediately before first error?
- What changed between "last known good" and "incident start"?
- Are there cascading failures?

### 4. Identify Trigger Event
The event that likely initiated the incident:
- Usually the last change before first symptoms
- May have delay between change and symptom

## Output Format

Return timeline as structured analysis:

```json
{
  "keyTimestamps": {
    "lastKnownGood": "2024-01-15T10:00:00Z",
    "triggerEvent": "2024-01-15T10:15:00Z",
    "firstError": "2024-01-15T10:17:00Z",
    "detectionTime": "2024-01-15T10:25:00Z",
    "mitigationStart": "2024-01-15T10:30:00Z"
  },
  "timeline": [
    {
      "timestamp": "2024-01-15T10:00:00Z",
      "event": "System operating normally",
      "type": "baseline",
      "source": "health_checks"
    },
    {
      "timestamp": "2024-01-15T10:15:00Z",
      "event": "Deployment deploy-123 went live",
      "type": "deployment",
      "source": "render",
      "significance": "high",
      "changes": ["Updated auth middleware"]
    },
    {
      "timestamp": "2024-01-15T10:17:00Z",
      "event": "First NullPointerException in auth handler",
      "type": "error",
      "source": "logs",
      "significance": "critical"
    }
  ],
  "causationChain": [
    {
      "cause": "Deployment deploy-123",
      "effect": "New auth middleware active",
      "lag": "0m"
    },
    {
      "cause": "New auth middleware",
      "effect": "Missing null check on user object",
      "lag": "0m"
    },
    {
      "cause": "Missing null check",
      "effect": "NullPointerException on anonymous users",
      "lag": "2m (first anonymous request)"
    }
  ],
  "likelyTrigger": {
    "event": "Deployment deploy-123",
    "timestamp": "2024-01-15T10:15:00Z",
    "confidence": 85,
    "reasoning": "Errors began 2 minutes after deployment, affecting code changed in that deployment"
  }
}
```

## Analysis Patterns

### Deployment-Related
- Check: Time between deployment and first error
- Pattern: Errors start immediately or within minutes of deploy
- Action: Compare deployed code changes with error location

### Gradual Degradation
- Check: Slow increase in errors over time
- Pattern: Resource exhaustion, memory leak, connection pool
- Action: Look for accumulating metrics

### External Trigger
- Check: No internal changes near incident time
- Pattern: Errors correlate with external API status
- Action: Check third-party status pages, API changes

### Cascade Failure
- Check: Multiple different errors in sequence
- Pattern: One failure causes secondary failures
- Action: Find the root failure in the chain

## Best Practices

1. **Precision**: Use exact timestamps, not approximations
2. **Multiple Sources**: Correlate logs, metrics, and events
3. **Context Matters**: Note what was happening at each point
4. **Gaps Are Clues**: Missing data points may indicate failures
5. **Visual Thinking**: Imagine the timeline as a graph
