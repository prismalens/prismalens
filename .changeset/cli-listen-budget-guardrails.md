---
"prismalens": minor
---

Budget guardrails for `pl listen`, so an alert storm can't fan out into unbounded investigations. Three new `listen` config keys cap dispatch: `max_concurrent` (default 2) and `max_per_hour` (default 10, a rolling 60-minute window) gate whether a group is investigated, and `max_turns` bounds an individual Claude Code run. Over-cap groups are recorded as terminal `suppressed` runs with a suppression reason — visible in `pl status`, filterable with `--status suppressed` — rather than dropped silently. A suppressed run is not retried, since intake has already acknowledged the alert.
