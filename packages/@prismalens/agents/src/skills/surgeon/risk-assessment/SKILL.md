---
name: risk-assessment
description: Assesses the risk level of proposed changes and provides blast radius analysis to inform safe remediation.
---

# Risk Assessment Skill

## Purpose
Evaluate proposed fixes for potential risks before implementation. Helps prioritize safe remediation and identifies changes requiring extra scrutiny or approval.

## Why This Matters
- **Prevent Cascading Failures**: Bad fixes can make incidents worse
- **Informed Decisions**: Stakeholders need risk context for approval
- **Compliance**: Some changes require CAB approval based on risk
- **Accountability**: Document risk assessment for postmortem

## Available Tools
- `assess_change_risk(proposedChange)` - Calculate risk score and factors

## Risk Scoring Model

### Risk Score (0-100)

| Score Range | Level | Action Required |
|-------------|-------|-----------------|
| 0-25 | Low | Standard review |
| 26-50 | Medium | Peer review recommended |
| 51-75 | High | Team lead approval |
| 76-100 | Critical | CAB/Change board approval |

### Risk Factors

#### 1. Blast Radius (40% weight)
How many users/services could be affected?

| Scope | Score |
|-------|-------|
| Single function | 5 |
| Single service | 15 |
| Service cluster | 30 |
| Cross-service | 50 |
| Platform-wide | 80 |
| Customer-facing | +20 |

#### 2. Reversibility (25% weight)
How easy is it to undo?

| Type | Score |
|------|-------|
| Feature flag toggle | 5 |
| Config revert | 10 |
| Code rollback | 20 |
| Database migration | 50 |
| Data modification | 70 |
| Data deletion | 90 |

#### 3. Complexity (20% weight)
How complex is the change?

| Complexity | Score |
|------------|-------|
| Single line | 5 |
| Single file | 15 |
| Multiple files | 30 |
| Multiple services | 50 |
| Architecture change | 70 |

#### 4. Testing Coverage (15% weight)
What testing exists?

| Coverage | Score |
|----------|-------|
| Full test coverage | 5 |
| Partial tests | 20 |
| Manual testing only | 40 |
| No tests | 60 |
| Cannot test in staging | 80 |

## Process

### 1. Analyze Proposed Change
Extract from proposal:
- Files/services affected
- Type of change (code/config/data)
- Dependencies involved
- Required deployments

### 2. Calculate Component Scores
For each risk factor:
- Determine applicable score
- Apply modifiers for context
- Document reasoning

### 3. Compute Overall Risk
```
overallRisk = (blastRadius * 0.4) + (reversibility * 0.25) +
              (complexity * 0.2) + (testingGap * 0.15)
```

### 4. Generate Recommendations
Based on risk level:
- Required approvals
- Mitigation steps
- Monitoring needs
- Rollback triggers

## Output Format

Use `assess_change_risk` tool:

```json
{
  "proposedChange": {
    "title": "Fix null pointer in auth handler",
    "category": "code_fix",
    "files": ["src/auth/handler.ts"],
    "services": ["api-gateway"]
  },
  "riskAssessment": {
    "overallScore": 32,
    "level": "medium",
    "factors": {
      "blastRadius": {
        "score": 35,
        "reasoning": "Auth handler affects all API requests",
        "scope": "service-wide"
      },
      "reversibility": {
        "score": 20,
        "reasoning": "Code change can be reverted via git",
        "rollbackTime": "5 minutes"
      },
      "complexity": {
        "score": 15,
        "reasoning": "Single file, minimal code change",
        "linesChanged": 3
      },
      "testingCoverage": {
        "score": 40,
        "reasoning": "Auth handler has partial test coverage",
        "existingTests": ["auth.test.ts"],
        "gapIdentified": "No test for null user case"
      }
    },
    "mitigations": [
      {
        "action": "Add unit test for null user scenario before deploying",
        "reducesRiskBy": 15
      },
      {
        "action": "Deploy with feature flag for gradual rollout",
        "reducesRiskBy": 10
      }
    ],
    "approvalRequired": "peer_review",
    "recommendedMonitoring": [
      "Watch auth error rate for 15 minutes post-deploy",
      "Alert if 5xx rate exceeds 1%"
    ],
    "rollbackTriggers": [
      "Auth error rate > 5%",
      "API latency p99 > 2s"
    ]
  }
}
```

## Special Risk Scenarios

### Database Changes
- Always HIGH risk minimum
- Require backup verification
- Plan for long-running migrations
- Consider read replica lag

### Config Changes
- Check for dependent services
- Validate against schema
- Plan propagation time
- Document expected behavior change

### Third-Party Dependencies
- Check for breaking changes
- Verify compatibility
- Consider fallback behavior
- Plan for API changes

### Security-Related Changes
- Require security review
- Check for credential exposure
- Verify access controls
- Document compliance impact

## Integration with Other Skills

- **propose_fix**: Risk assessment informs priority and urgency
- **runbook-lookup**: Check if runbook has risk notes
- **rollback-proposal**: Risk factors inform rollback decision

## Approval Matrix

| Risk Level | Code Change | Config Change | Data Change |
|------------|-------------|---------------|-------------|
| Low | Self-merge | Self-deploy | Peer review |
| Medium | Peer review | Peer review | Team lead |
| High | Team lead | Team lead | CAB |
| Critical | CAB | CAB | CAB + DBA |

## Best Practices

1. **Be Conservative**: When uncertain, score higher
2. **Document Reasoning**: Explain each score for audit trail
3. **Consider Timing**: Late night deploys are riskier
4. **Check Dependencies**: Hidden dependencies increase risk
5. **Plan Monitoring**: Every change needs observation period
6. **Define Rollback**: Know the escape hatch before deploying
