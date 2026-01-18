---
name: hypothesis-formation
description: Forms and validates root cause hypotheses based on gathered evidence, assigning confidence levels using systematic analysis.
---

# Hypothesis Formation Skill

## Purpose
Systematically form root cause hypotheses from gathered evidence, evaluate their likelihood, and assign appropriate confidence levels.

## Available Tools
- `form_hypothesis(hypothesis)` - Record a formal hypothesis with evidence

## Process

### 1. Evidence Review
Organize gathered evidence into categories:
- **Direct Evidence**: Stack traces, error messages, explicit failures
- **Circumstantial Evidence**: Timing correlations, patterns
- **Negative Evidence**: What was checked and ruled out

### 2. Generate Candidate Hypotheses
For each potential cause:
- State the hypothesis clearly
- List supporting evidence
- Identify potential gaps

### 3. Evaluate Confidence
Apply the confidence framework:

| Confidence | Evidence Required |
|------------|-------------------|
| 90-100%    | Direct evidence (stack trace matches code, config diff proves issue) |
| 70-89%     | Strong correlation (timing + code change + error pattern) |
| 50-69%     | Partial evidence with gaps |
| Below 50%  | Speculation, needs more investigation |

### 4. Categorize Root Cause
- **code**: Bug, logic error, null pointer, race condition
- **config**: Wrong settings, missing env var, threshold issue
- **infrastructure**: Resource limits, network, disk, scaling
- **external**: Third-party API, dependency failure

## Output Format

Use the `form_hypothesis` tool with:

```json
{
  "rootCause": "Clear statement of what caused the incident",
  "category": "code|config|infrastructure|external",
  "confidence": 85,
  "evidence": [
    {
      "type": "direct|circumstantial|negative",
      "description": "What the evidence shows",
      "source": "logs|code|commits|deployment"
    }
  ],
  "reasoning": "Step-by-step explanation of how evidence leads to conclusion",
  "alternativeHypotheses": [
    {
      "hypothesis": "Alternative explanation",
      "confidence": 40,
      "whyLess": "Lacks X evidence"
    }
  ],
  "gapsRemaining": [
    "Could not verify Y",
    "Need to check Z to confirm"
  ]
}
```

## Confidence Guidelines

### High Confidence (90%+)
Required evidence:
- Stack trace pointing to specific code
- Error message matches code path exactly
- Config change directly causes error
- Reproduction steps confirmed

### Medium-High Confidence (70-89%)
Evidence pattern:
- Timing correlation with deployment/change
- Multiple circumstantial evidence points
- Pattern matches known failure mode
- No contradicting evidence

### Medium Confidence (50-69%)
Evidence pattern:
- Single strong indicator
- Some gaps in the chain
- Plausible but not proven

### Low Confidence (<50%)
- Speculation based on similar past incidents
- Timing-only correlation
- Need more investigation

## Best Practices

1. **Multiple Hypotheses**: Form at least 2-3 for complex incidents
2. **Evidence Chains**: Show how evidence connects to hypothesis
3. **Be Honest**: Acknowledge gaps and uncertainties
4. **Prioritize**: Rank hypotheses by confidence for Surgeon
5. **Update**: Revise confidence if new evidence emerges
