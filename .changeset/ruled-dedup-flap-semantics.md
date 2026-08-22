---
"prismalens": patch
---

Alert dedup and flap suppression get ruled, tested semantics across all three dedup layers (#231).

Before this, the three layers that deduplicate an alert agreed on nothing, and none of them had a concept of a flap. A refire of a resolved alert bumped a counter and never reopened it, so a condition that came back minutes after resolving went permanently silent. New behaviour, keyed off one global knob `PRISMALENS_ALERT_FLAP_WINDOW_MINUTES` (default 15):

- **API dedup is now status-aware.** On a `dedupKey` hit: an open alert (`triggered`/`acknowledged`/`correlated`) bumps the counter with its status untouched; a `resolved` alert refiring **inside** the flap window reopens to `triggered` and appends a "reopened by refire (flap)" timeline entry to its incident; a `resolved` alert refiring **outside** the window opens a genuinely new alert row, keeping episode history honest; a `suppressed` alert bumps the counter and **never** reopens — suppression stays forward-only (ADR-0028).
- **`Alert.dedupKey` and `Alert.externalId` are no longer unique columns**, which the new-episode branch requires (a refired condition reuses its stable fingerprint). Additive migrations `20260812180006_alert_dedup_key_not_unique` and `20260822161331_alert_external_id_not_unique` swap the unique indices for plain ones in both the sqlite and pg lineages; reads (`findByDedupKey`, `findBySourceAlertId`) take the newest episode.
- **The GitHub webhook path gets delivery-GUID idempotency**, matching the generic and Render paths. `processGithubWebhook` now routes through the same `ingestEvent` wrapper keyed on `X-GitHub-Delivery`, which GitHub reuses across redeliveries.
- **CLI grouping records cross-run flap linkage.** A refire arriving after its investigation completed still starts a new run — nothing is resurrected — but the new run's group record now carries `previousRunId` when a prior run for the same dedupe key finished inside the flap window. Persisted via the CLI store's own additive-migration path; existing `prismalens-cli.db` files gain the column in place.

The semantics, including a worked lifecycle example, are documented in `docs/alert-dedup-and-grouping.md`, and every ruled branch is pinned by regression tests.
