---
"prismalens": patch
---

UX-study bug fixes:

- The alerts route honours `?tab=unmapped` with consistent filtering matching the dashboard's definition (`UNASSIGNED_ALERT_STATUSES` / `isUnassignedAlert`, status `triggered` or `acknowledged` with no incident) and aligned limit (100).
- `AlertQuerySchema`'s `hasIncident` filter parses the HTTP query string "false" as `false`.
- `IncidentDetailPanel` now reads `rootCause` from the latest completed investigation rather than dropping it when a newer investigation is running or failed, while keeping the progress bar gated on the latest running investigation.
- `incidents.list` selects multiple investigations so completed investigations remain available alongside in-progress or failed runs.

