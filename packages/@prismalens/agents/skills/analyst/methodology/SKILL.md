---
name: methodology
description: Root cause analysis methodology — form hypotheses, evaluate evidence, investigate code, challenge
allowed-tools:
---

# Analysis Methodology

Follow this structured approach for root cause analysis:

## 1. Form Hypotheses (2-4 competing)

Generate competing root cause hypotheses from the gathered data.
Each hypothesis should have a distinct category (code_bug, config_change,
infrastructure, dependency, deployment, unknown).

Weight recent changes heavily: deployments, config changes, and commits
immediately before the incident are high-signal indicators.

## 2. Evaluate Evidence

For each hypothesis, identify supporting and contradicting evidence.
Mark evidence as `verified: true` only when confirmed by a tool call.
LLM reasoning alone = `verified: false`.

Consider these evidence sources:
- Logs: error patterns, timing, affected services
- Alerts: severity, scope, correlation with changes
- Change events: deployments, config changes near incident time
- Similar incidents: past root causes and resolutions

## 3. Code Investigation

Use workspace tools to gather verified evidence:

- **Clone the repository** into `/workspace/` if code analysis is needed
- **Search code** for error strings, affected function names, config keys using `grep`
- **Read suspicious files** to understand the code path that triggered the error
- **Check recent changes**: compare code before/after a suspect commit
- **Write analysis scripts** for batch operations (e.g., scanning multiple files for a pattern)

Evidence produced by tools (grep matches, script output) is `verified: true`
and weighted more heavily by the scoring formula.

### Code Investigation Workflow

1. Clone → `execute("git clone <url> /workspace/repo")`
2. Search → `grep("ConnectionTimeout|ECONNREFUSED", "/workspace/repo/src")`
3. Read → `read_file("/workspace/repo/src/config/database.ts")`
4. Script → `write_file("/workspace/analyze.py", ...)` then `execute("python3 /workspace/analyze.py")`

### Best Practices

- **Grep broadly, then narrow**: Start with broad error strings, drill into specific files
- **Use scripts for batch work**: Write Python/Node scripts for operations needing many tool calls
- **Keep output small**: Scripts should filter/aggregate results, not dump raw data
- **Check gatherer scripts**: `ls("/skills/gatherer/")` for reusable script templates

### Web Research

Use `web_search` and `web_browse` to find known issues and documentation:
- Search for error messages to find matching GitHub issues or Stack Overflow answers
- Browse documentation pages for configuration options or known limitations
- Cross-reference findings with gathered data to strengthen or weaken hypotheses

## 4. Challenge Hypotheses

Actively search for contradictions to avoid confirmation bias:
- Temporal inconsistency: does the timeline support the causal chain?
- Scope mismatch: if hypothesis X is the cause, why didn't other services fail?
- Missing expected evidence: if hypothesis X were true, what should we see that we don't?
- Alternative explanations: could the same evidence support a different root cause?

## 5. Produce Results

Report all hypotheses with confidence scores, evidence (with verified flags),
contradictions, data gaps, and a summary assessment.
Be honest about confidence — unverified hypotheses should have low confidence.
With verified evidence from tool use, higher confidence is justified.
