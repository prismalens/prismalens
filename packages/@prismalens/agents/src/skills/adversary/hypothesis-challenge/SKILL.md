---
name: hypothesis-challenge
description: Challenge hypotheses to strengthen root cause analysis using Socratic questioning and evidence-based reasoning.
capability: adversarial-reasoning
---

# Hypothesis Challenge Skill

## Purpose
Challenge Detective's hypotheses to prevent premature conclusions and strengthen analysis. Based on ACL 2024 research showing selective challenge prevents error entrenchment.

## Activation Criteria

Only challenge hypotheses that meet one of these conditions:
- **High Confidence (>=80%)**: Strong claims need scrutiny
- **Thin Evidence (<=2 items)**: Conclusions from limited data
- **Critical Severity**: High-impact decisions need validation

Do NOT challenge every hypothesis - that leads to worse outcomes.

## Available Tools

- `challenge_hypothesis(input)` - Record formal challenges to a hypothesis
- `refine_hypothesis(input)` - Propose improvements to a hypothesis
- `pattern_match(text)` - Check error against known incident patterns

## Process

### 1. Pattern Analysis
First, use `pattern_match` to check if the error matches known patterns:

```
pattern_match({
  text: "Database connection timeout after 30s",
  categories: ["database", "network"]
})
```

This provides baseline knowledge before challenging.

### 2. Identify Assumptions
List unstated premises in the hypothesis:

| Assumption Type | Example |
|-----------------|---------|
| **Causal** | "The deployment caused the outage" (timing = causation?) |
| **Scope** | "Only this service is affected" (checked others?) |
| **Completeness** | "All evidence has been gathered" (more data available?) |
| **Technical** | "Connection pool is the bottleneck" (measured?) |

### 3. Find Blind Spots
Check what data was NOT considered:

- Were upstream services checked?
- Were logs from all time periods reviewed?
- Were configuration changes considered?
- Was the database health verified?
- Were there similar recent incidents?

### 4. Propose Alternatives
Generate alternative explanations for the same symptoms:

```json
{
  "symptom": "API timeouts",
  "originalHypothesis": "Database is slow",
  "alternatives": [
    "Network latency between app and DB",
    "Connection pool exhaustion",
    "App-level query inefficiency",
    "External dependency timeout cascade"
  ]
}
```

### 5. Stress Test
Apply "What if X is wrong?" reasoning:

- If it's NOT the deployment, what else changed?
- If the database is fine, where else would latency come from?
- If the hypothesis is correct, what OTHER symptoms should exist?

## Output Format

Use `challenge_hypothesis` with structured challenges:

```json
{
  "hypothesisId": "h1",
  "originalConfidence": 85,
  "originalEvidenceCount": 2,
  "challenges": [
    {
      "type": "assumption",
      "description": "Timing correlation assumed to be causation",
      "evidence": "Similar timeouts occurred 2 days ago without deployment",
      "source": "pattern-match"
    },
    {
      "type": "blind_spot",
      "description": "Upstream service health not verified",
      "evidence": null,
      "source": null
    },
    {
      "type": "alternative",
      "description": "Connection pool exhaustion could cause same symptoms",
      "evidence": "Pattern matches database connection pool issues",
      "source": "pattern-match"
    }
  ],
  "alternativeHypotheses": [
    "Connection pool exhaustion from traffic spike",
    "Network timeout between load balancer and app"
  ],
  "recommendedConfidenceAdjustment": -0.15,
  "skillsUsed": ["hypothesis-challenge", "pattern-match"]
}
```

## Challenge Severity Guidelines

| Severity | Criteria | Confidence Adjustment |
|----------|----------|----------------------|
| **HIGH** | 2+ assumption challenges OR critical blind spot | -0.2 to -0.3 |
| **MEDIUM** | 1 assumption OR 1+ blind spots | -0.1 to -0.2 |
| **LOW** | Only alternatives, no fundamental issues | -0.05 to -0.1 |

## Best Practices

1. **Be Specific**: Generic skepticism is unhelpful
2. **Provide Evidence**: Support challenges with data when possible
3. **Stay Constructive**: Goal is improvement, not rejection
4. **Know When to Stop**: If hypothesis holds up, don't force challenges
5. **Consider Context**: Some incidents are genuinely straightforward

## Anti-Patterns to Avoid

- Challenging EVERY hypothesis (entrenchment risk)
- Generic challenges without specifics
- Ignoring time constraints during active incidents
- Proposing alternatives without evidence
- Being contrarian for its own sake
