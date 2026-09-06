---
"prismalens": patch
---

Four storm-path follow-ups from the #276 pre-merge review (#302):

- Worker: drop the redundant re-parse of the job payload and move the remaining `InvestigationJobDataSchema.parse` inside the persisting try/catch, so a schema-parse failure marks the investigation row `failed` instead of leaving it dangling `pending`.
- Worker: include `**/*.test.ts`/`**/*.spec.ts` in `packages/worker/tsconfig.json`'s typecheck and fix the type errors that surfaced (storm-test alert literals missing `annotations`/`startsAt`, a fetch mock under-declaring its own signature, and `flush()` calls against the optional `InvestigationStore.flush` narrowed honestly instead of asserted away).
- API: the auto-trigger path (`InvestigationTriggerService.triggerInvestigation`) now fetches and threads the incident's alerts into the job payload, matching the manual trigger path instead of silently relying on the worker's DB fallback.
- API: `serializeAlert` in both the alerts and incidents controllers now whitelists response fields explicitly instead of spreading the raw Prisma row, which was leaking the dormant `tenantId` column (ADR-0011 §6) onto alert responses.
