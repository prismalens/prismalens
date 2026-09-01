---
"prismalens": patch
---

Un-suppressing an alert no longer dead-ends. `POST /alerts/{id}/correlate` used to
re-suppress and answer `200` with no incident whenever an enabled `suppress` rule still
matched — the caller was given no reason and no way forward. It now refuses with `409
CONFLICT`, naming the rule and the `PATCH /correlation/rules/{id}` call that unblocks the
alert. The rule is never bypassed, so "suppressed by rule X" stays true.

`GET /alerts/{id}` gains `suppressedBy` — the enabled rule currently holding a suppressed
alert down, or `null` when nothing blocks re-correlation. It is derived from the live rule
set on every read, never stored, so disabling or amending the rule clears it immediately.

Also fixes a latent staleness bug: `runCorrelation` re-read the alert but evaluated the
caller's copy, so a stale `status` could drive a redundant write through the suppress
guard.
