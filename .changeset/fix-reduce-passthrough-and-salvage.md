---
"prismalens": patch
"@prismalens/engine": patch
"@prismalens/config": patch
---

Fix subscription-only `pl listen`/`pl investigate` runs producing no report (#131, #132). The Tier-1 reduce/synthesis step is the only direct model call in an investigation; with no provider key it fell back to the keyless cloud endpoint, 401'd, and the run was marked errored with nothing persisted — even though the harness's diagnosis was already gathered. Now: when no Tier-1 provider is configured the supervisor skips the model call entirely and persists the harness's submitted branch conclusion(s) as a report clearly marked raw/un-synthesized (#131); and when the reduce model call throws for any reason, the same raw report is salvaged with the synthesis error surfaced in it rather than erroring the run (#132). `pl listen` prints one startup line noting reports will be raw pass-through until a provider is configured (a supported subscription-only path, not a failure). No schema change; raw reports flow through the existing done/finish path and render in `pl report` and Slack.
