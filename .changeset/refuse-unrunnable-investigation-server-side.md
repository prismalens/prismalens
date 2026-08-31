---
"prismalens": patch
---

Refuse unrunnable investigations server-side (#520, ADR-0031).

- `POST /api/incidents/:id/investigate` evaluates `resolveHarnessSelection` before modifying status or enqueueing a job.
- Returns HTTP 412 (`PRECONDITION_FAILED`) with typed refusal payload (`InvestigationRefusalSchema`) containing `failure`, `reason`, and `harness`.
- Incident status remains unchanged and no worker job is enqueued when the selection is unrunnable.
