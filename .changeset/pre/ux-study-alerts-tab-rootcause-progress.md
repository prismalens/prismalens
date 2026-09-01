---
"prismalens": patch
---

UX-study bug fixes:

- The alerts route honours `?tab=unmapped`, and the unassigned set (no incident, status `triggered` or `acknowledged` — `UNASSIGNED_ALERT_STATUSES`) is now resolved server-side by the new `AlertQuerySchema.unassigned` filter. Applying it in the browser windowed all statuses first, so the Unmapped tab could show fewer alerts than the dashboard counted whenever more than `limit` alerts had no incident.
- The dashboard's "Unassigned" count reads `pagination.total` from that same filtered query instead of counting a capped page, so the count and the tab always agree.
- `AlertQuerySchema`'s `hasIncident` filter parses the HTTP query string "false" as `false`.
- `IncidentDetailPanel` now reads `rootCause` from the latest completed investigation rather than dropping it when a newer investigation is running or failed, while keeping the progress bar gated on the latest running investigation.
- `incidents.list` selects multiple investigations so completed investigations remain available alongside in-progress or failed runs.

