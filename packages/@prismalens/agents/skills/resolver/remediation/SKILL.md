---
name: remediation
description: Evidence-based remediation — propose fixes grounded in precedent, validate, assess risk
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

## 4. Validate Recommendations

Use workspace tools to verify feasibility before finalizing:

- **Write a test script** that checks if the proposed fix would work
- **Apply the fix** in the workspace and run the project's test suite
- **Check service state** via `http_request` to confirm the current situation
- **Run a minimal validation** — even a quick sanity check adds confidence

Note validation results in your recommendation steps.

### Validation Workflow

1. Write validation script:
   ```
   write_file("/workspace/validate-fix.py", "...")
   execute("python3 /workspace/validate-fix.py")
   ```
2. Run existing tests: `execute("cd /workspace/repo && npm test 2>&1 | tail -20")`
3. Apply patch and verify: `execute("cd /workspace/repo && git diff HEAD~1 -- src/config.ts")`

### Best Practices

- **Test before recommending**: Validate that your fix actually works when possible
- **Keep scripts focused**: One script per validation, with clear PASS/FAIL output
- **Time-box validation**: A quick sanity check is better than none

### Web Research

Use `web_search` and `web_browse` to find fix documentation and precedent:
- Search for known fixes for the identified root cause
- Browse official docs for correct configuration values or migration guides
- Look for regression reports related to proposed fixes

## 5. Assess Risk Per Recommendation

For each recommendation, evaluate:
- **Risk level**: critical/high/medium/low — what could go wrong?
- **Blast radius**: Which systems or users could be affected?
- **Reversibility**: fully_reversible, partially_reversible, or irreversible

High-risk + irreversible = flag clearly. Prefer reversible actions.

## 6. Honest Assessment

Be transparent about limitations:
- If root cause confidence is low, say so
- If recommending novel approaches (no precedent), acknowledge higher uncertainty
- If the fix addresses symptoms but not root cause, note it
- If validation passed, note it — this increases recommendation confidence
