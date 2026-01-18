---
name: pattern-correlation
description: Correlates patterns across multiple data sources (logs, metrics, code changes) to strengthen or weaken hypotheses.
---

# Pattern Correlation Skill

## Purpose
Cross-reference patterns from multiple data sources to identify correlations that strengthen or weaken hypotheses about the incident root cause.

## Available Tools
- `form_hypothesis(hypothesis)` - Record correlation-based findings

## Process

### 1. Identify Pattern Sources
Gather patterns from:
- **Logs**: Error frequency, message patterns, timing
- **Metrics**: CPU, memory, response times, error rates
- **Code**: Changed files, functions, dependencies
- **Deployment**: Release timing, config changes

### 2. Cross-Reference Patterns
Look for correlations:
- Timing alignment across sources
- Shared identifiers (request IDs, user IDs)
- Cause-effect relationships
- Inverse correlations (one up, another down)

### 3. Evaluate Correlation Strength
- **Strong**: Multiple independent sources agree
- **Medium**: Two sources correlate with some noise
- **Weak**: Single source or conflicting patterns

### 4. Draw Conclusions
Use correlations to:
- Confirm or refute hypotheses
- Identify the most likely root cause
- Suggest areas for further investigation

## Output Format

Return correlation analysis:

```json
{
  "patterns": [
    {
      "id": "P1",
      "source": "logs",
      "description": "NullPointerException errors at rate 10/min",
      "timeRange": "10:17-10:45",
      "significance": "primary_symptom"
    },
    {
      "id": "P2",
      "source": "deployment",
      "description": "deploy-123 released at 10:15",
      "timeRange": "10:15",
      "significance": "potential_cause"
    },
    {
      "id": "P3",
      "source": "metrics",
      "description": "Error rate jumped from 0.1% to 5%",
      "timeRange": "10:17 onwards",
      "significance": "confirms_symptom"
    },
    {
      "id": "P4",
      "source": "code",
      "description": "auth/handler.ts modified in deploy-123",
      "timeRange": "N/A",
      "significance": "links_cause_to_symptom"
    }
  ],
  "correlations": [
    {
      "patterns": ["P1", "P3"],
      "type": "temporal",
      "strength": "strong",
      "description": "Log errors and metric spike start at same time"
    },
    {
      "patterns": ["P2", "P1"],
      "type": "causal",
      "strength": "strong",
      "description": "Deployment precedes errors by 2 minutes"
    },
    {
      "patterns": ["P4", "P1"],
      "type": "contextual",
      "strength": "strong",
      "description": "Error occurs in file modified by deployment"
    }
  ],
  "correlationStrength": {
    "overall": "strong",
    "score": 85,
    "reasoning": "Three independent correlations all point to deploy-123"
  },
  "contraindications": [
    {
      "pattern": "No traffic spike observed",
      "impact": "Rules out load-related cause",
      "hypothesisAffected": "Resource exhaustion"
    }
  ],
  "conclusion": {
    "supportedHypothesis": "Deployment deploy-123 introduced bug",
    "confidenceBoost": 15,
    "newConfidence": 85
  }
}
```

## Correlation Types

### Temporal Correlation
Events happen at the same time or in predictable sequence
- Strong: Within seconds
- Medium: Within minutes
- Weak: Same hour

### Causal Correlation
One event directly causes another
- Requires logical connection
- Should have appropriate time lag

### Contextual Correlation
Events share context (same file, same service, same user)
- Strengthens causal arguments
- Helps narrow scope

### Inverse Correlation
One thing increases as another decreases
- Useful for resource issues
- May indicate compensation/fallback

## Best Practices

1. **Multiple Sources**: At least 3 sources for strong conclusions
2. **Independence**: Correlations from independent sources are more valuable
3. **Contraindications**: Note what doesn't correlate (rules out hypotheses)
4. **Quantify**: Use numbers where possible (timing, rates)
5. **Confidence Adjustment**: Update hypothesis confidence based on correlations
