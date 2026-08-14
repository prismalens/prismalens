---
"prismalens": patch
---

Three UX-study bug fixes:

- The alerts route now declares `validateSearch` and honours `?tab=unmapped`, so the dashboard's "Unassigned" links (which already pointed at it) land on a real Unmapped tab instead of being silently dropped.
- `AlertQuerySchema`'s `hasIncident` filter now parses the HTTP query string "false" as `false` — `z.coerce.boolean()` is `Boolean(value)`, and any non-empty string is truthy, so it previously coerced to `true`.
- `latestInvestigation.rootCause` now reaches the client: both the oRPC output schema and the incidents controller's serializer were dropping it even though the query selected it.
- `incidents.list`'s query no longer filters the latest investigation to `status: "completed"`, so a running investigation can reach the dashboard and its progress bar (gated on `status === "running"`) can actually render.
