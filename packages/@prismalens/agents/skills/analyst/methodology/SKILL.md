---
name: methodology
description: Root cause analysis methodology — form hypotheses, evaluate evidence, challenge
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

## 3. Challenge Hypotheses

Actively search for contradictions to avoid confirmation bias:
- Temporal inconsistency: does the timeline support the causal chain?
- Scope mismatch: if hypothesis X is the cause, why didn't other services fail?
- Missing expected evidence: if hypothesis X were true, what should we see that we don't?
- Alternative explanations: could the same evidence support a different root cause?

## 4. Produce Results

Report all hypotheses with confidence scores, evidence (with verified flags),
contradictions, data gaps, and a summary assessment.
Be honest about confidence — unverified hypotheses should have low confidence.
