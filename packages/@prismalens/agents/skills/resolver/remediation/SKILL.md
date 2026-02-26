---
name: remediation
description: Evidence-based remediation — propose fixes grounded in precedent, assess risk
allowed-tools:
---

# Remediation Methodology

Follow this structured approach for proposing remediation steps:

## 1. Identify Root Cause

Review the analyst's hypotheses. Focus on the highest-confidence root cause.
If multiple hypotheses have similar confidence, propose recommendations
that address the most likely ones.

## 2. Check Precedent

Look at similar past incidents for proven resolutions:
- Same root cause category? Reuse that resolution approach (precedentBased: true)
- Same service affected? Consider service-specific patterns
- Similar symptoms but different cause? Avoid the wrong fix

Mark recommendations as `precedentBased: true` only when directly grounded
in a past resolution. Novel approaches = `precedentBased: false`.

## 3. Propose Recommendations (2-5)

For each recommendation:
- **Title**: Clear, actionable name
- **Category**: code_fix, config_change, rollback, monitoring, investigation
- **Priority**: critical > high > medium > low
- **Urgency**: immediate (do now), short_term (this sprint), long_term (backlog)
- **Steps**: Concrete, ordered actions someone can follow
- **Estimated effort**: minutes, hours, or days

Order recommendations by urgency — immediate actions first.

## 4. Assess Risk Per Recommendation

For each recommendation, evaluate:
- **Risk level**: critical/high/medium/low — what could go wrong?
- **Blast radius**: Which systems or users could be affected?
- **Reversibility**: fully_reversible, partially_reversible, or irreversible

High-risk + irreversible = flag clearly. Prefer reversible actions.

## 5. Honest Assessment

Be transparent about limitations:
- If root cause confidence is low, say so
- If recommending novel approaches (no precedent), acknowledge higher uncertainty
- If the fix addresses symptoms but not root cause, note it
