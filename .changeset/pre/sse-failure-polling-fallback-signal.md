---
"prismalens": patch
---

Tell the reader when the live investigation stream drops and the page falls back to polling (issue #462: "fix(frontend): SSE failure shows a progress bar with no error signal, and the stream panel's own error chrome is unreachable").

- Distinguish SSE transport failure from in-stream canonical error events so the polling fallback card renders only when the live connection actually drops.
- Render in-stream error events inside the active investigation stream panel without claiming the connection is unavailable.
- Resolve terminal stream status to `failed` when canonical error events were emitted before the `done` marker, displaying a distinct failure indicator in the stream panel header.
- Give the polling fallback progress card an explicit affordance (`Polling` badge and `Live stream unavailable, polling for progress` status line) so readers understand the live connection is unavailable while the run continues polling in the background.
- Remove the unreachable `status === "error"` branch and prop type from `InvestigationStreamPanel`.
