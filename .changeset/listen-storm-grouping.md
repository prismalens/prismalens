---
"prismalens": minor
---

Adds alert storm grouping to `pl listen`. Firing alerts arriving close together are now debounced (default `listen.grouping_window_ms` of 60000ms) into a single group using a coarse key ladder (Alertmanager's `groupKey`/`groupLabels` if present, else `alertname` + service label, else alert labels, else a fallback). One investigation is dispatched per group carrying the full multi-alert context. Alerts arriving while their group's investigation is already running attach to it (deduped by fingerprint or label hash) instead of triggering redundant runs. Group metadata is recorded as a `GroupRecord` with `formedBy: "window"`.
