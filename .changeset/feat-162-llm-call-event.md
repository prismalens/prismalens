---
"@prismalens/contracts": minor
"@prismalens/engine": minor
---

New `llm_call` canonical event records each tier-1 model call (phase, model, token usage, latency, outcome + failure cause), and the Claude Code harness result's cost/usage accounting (`total_cost_usd`, `usage`, `modelUsage`, `num_turns`, `duration_ms`) is now captured on `branch_done` instead of discarded (#162).
