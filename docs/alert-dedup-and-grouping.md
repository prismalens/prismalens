# Alert dedup, grouping, and flap suppression

PrismaLens deduplicates the same alert firing twice in **three independent layers**. They
run at different points in the pipeline, key on different things, and — before
[#231](https://github.com/prismalens/prismalens/issues/231) — agreed on nothing. This page
is the settled model: what each layer is for, and the ruled semantics each one now follows.

Governing decision: ADR-0028 (suppression is forward-only; no invented numeric thresholds).

---

## The three layers

| Layer | Lives in | Keyed on | Scope of a "duplicate" | What it prevents |
| --- | --- | --- | --- | --- |
| **1. Webhook delivery idempotency** | `packages/api/src/modules/webhooks/webhooks.service.ts` | `Event.idempotencyKey` — the sender's `X-Idempotency-Key`, or GitHub's `X-GitHub-Delivery` GUID | The *same HTTP delivery* arriving twice | A network retry or provider redelivery creating two events |
| **2. API alert dedup** | `packages/api/src/modules/alerts/alerts.service.ts` | `dedupKey` = sha256(`source:title:severity:serviceId`) | The *same alert condition* firing again | One noisy condition creating N alert rows |
| **3. CLI grouping** | `packages/cli/src/cli/grouping.ts` | `dedupeKey` (Alertmanager `fingerprint`) inside a `groupKey` window | The *same page* arriving while an investigation is already running | One storm spawning N investigations |

They are not alternatives. A single Alertmanager storm can pass through all three: layer 1
drops literal redeliveries, layer 2 collapses repeats of one condition into an alert row
with an occurrence counter, layer 3 keeps a burst of distinct alerts inside one
investigation run.

```
Alertmanager / GitHub / Render
        │
        │  HTTP delivery
        ▼
┌───────────────────────────────┐
│ 1. delivery idempotency       │  same X-Idempotency-Key / X-GitHub-Delivery?
│    ingestEvent()              │  → replay the cached result, create nothing
└───────────────┬───────────────┘
                │ new Event row
                ▼
┌───────────────────────────────┐
│ 2. alert dedup (dedupKey)     │  same condition? → count / reopen / new episode
│    AlertsService.create()     │  ← this is where R1 + R2 live
└───────────────┬───────────────┘
                │ Alert row
                ▼
        correlation → incident

        (separate process)
`pl listen` ──▶ ┌───────────────────────────────┐
                │ 3. CLI grouping window        │  same fingerprint in flight?
                │    createGroupingLayer()      │  → attach to the running run
                └───────────────────────────────┘  ← R4 lives here
```

---

## The flap window — one global knob

`PRISMALENS_ALERT_FLAP_WINDOW_MINUTES`, **default 15**, declared in
`packages/@prismalens/config/src/env/server.ts`.

It is deliberately **one global setting, not per-rule**: ADR-0028's "no invented numeric
thresholds" spirit says start minimal and add granularity only once a real workload proves
one number insufficient.

The zod schema default is the single source of truth. Callers must **not** pass their own
fallback — a `configService.get(key, fallback)` fallback is dead code next to a schema
default, and a contradicting one is a silent bug.

Both consumers read the same knob:

* API — `AlertsService.flapWindowMs()` via `ConfigService`.
* CLI — `alertFlapWindowMs()`, the default for `GroupingOptions.flapWindowMs`.

---

## R1 / R2 — status-aware dedup at the API layer

On a `dedupKey` hit, `AlertsService.create()` reads the **newest** matching alert row and
branches on its status:

| Existing status | Refire timing | Outcome | Row effect |
| --- | --- | --- | --- |
| `triggered`, `acknowledged`, `correlated` | any | `counted` | `occurrenceCount + 1`, `lastOccurrence` updated, **status untouched** |
| `resolved` | `now - resolvedAt` **≤** flap window | `reopened` | `occurrenceCount + 1`, `status → triggered`, `resolvedAt → null`, `triggeredAt → now`, **plus a timeline entry** |
| `resolved` | `now - resolvedAt` **>** flap window | `new-episode` | a **new Alert row** under the same `dedupKey`, `occurrenceCount = 1` |
| `suppressed` | any | `counted-suppressed` | `occurrenceCount + 1`, **never reopens** |

Notes that are easy to get wrong:

* **The boundary is inclusive.** Exactly `flapWindow` after resolving still reopens.
* **`suppressed` is forward-only** (ADR-0028). A refire must never undo an operator's
  suppress rule, no matter how fast it comes back.
* **A resolved row with no `resolvedAt`** falls back to `updatedAt`. In practice that means
  it is treated as long-since resolved, not as a flap.
* **`dedupKey` is no longer a unique column.** R2b needs a second row under the same key,
  so migration `20260812180006_alert_dedup_key_not_unique` swaps the unique index for a
  plain one. Every read is `findFirst(... orderBy triggeredAt desc)` — newest episode wins.
* **The timeline entry is advisory.** An alert with no linked incident has nowhere to record
  the reopen, and a failed timeline write is logged, never fatal to ingest.

### Worked example — one condition's full lifecycle

Flap window = 15 min. `dedupKey` = `sha256("prometheus:HighErrorRate:high:svc-api")`.

| Time | Event | Layer 2 decision | Alert rows after |
| --- | --- | --- | --- |
| `12:00` | First firing | no `dedupKey` match → **create** | **A** `triggered`, count 1 |
| `12:02` | Refires while still open | status is `triggered` → **counted** | **A** `triggered`, count 2 |
| `12:05` | On-call acknowledges | (status change, not a refire) | **A** `acknowledged`, count 2 |
| `12:06` | Refires again | status is `acknowledged`, not terminal → **counted** | **A** `acknowledged`, count 3 |
| `12:10` | Condition clears; alert resolved | (status change) | **A** `resolved` @ `12:10`, count 3 |
| `12:18` | Refires — 8 min after resolve | inside window → **reopened** (R1) | **A** `triggered`, count 4, `resolvedAt` cleared, timeline entry *"Alert reopened by refire (flap)"* on incident |
| `12:25` | Resolved again | (status change) | **A** `resolved` @ `12:25`, count 4 |
| `12:55` | Refires — 30 min after resolve | outside window → **new episode** (R2b) | **A** `resolved` count 4 (history preserved) · **B** `triggered` count 1 |
| `12:57` | Operator suppresses B via a rule | correlation writes `suppressed` | **A** `resolved` · **B** `suppressed` count 1 |
| `13:00` | Refires again | newest row is B, `suppressed` → **counted-suppressed** (R2c) | **A** `resolved` · **B** **still** `suppressed`, count 2 |

The point of row **B**: history stays honest. `12:00–12:25` was one episode; `12:55` onward
is a genuinely new one, and correlation gets a fresh alert to reason about rather than a
resurrected row whose `triggeredAt` is an hour stale.

---

## R3 — GitHub delivery-GUID idempotency

`processGithubWebhook(dto, deliveryGuid?)` now routes through the same `ingestEvent()`
wrapper the generic and Render paths use, keyed on GitHub's `X-GitHub-Delivery` header.

No custom header is needed: GitHub already stamps a unique GUID per delivery and **reuses
it on a redelivery**, which is exactly the semantics `Event.idempotencyKey` wants. The three
branches are identical to the other providers':

* key already processed → replay the cached `WebhookResult`, create nothing;
* key seen but unlinked and recent → `CONFLICT`, the sender retries;
* key seen, unlinked, older than the 30 s grace → resume that event record.

A delivery with no GUID still processes normally, un-deduplicated.

> **Not yet wired to a route.** `webhooksContract` exposes `/webhooks/generic`,
> `/webhooks/prometheus`, and `/webhooks/render` — there is no GitHub route, so
> `processGithubWebhook` currently has no HTTP caller. The service-level idempotency is in
> place and pinned by tests; when a `/webhooks/github` route lands it need only read
> `x-github-delivery` off the request and pass it through.

---

## R4 — CLI cross-run flap linkage

**Record, don't resurrect.** A refire arriving *after* its investigation completed still
starts a brand-new run — resurrecting a finished run's context is complexity with no
consumer today. The only change is that the new run's group record carries
`previousRunId` when a prior run for the same `dedupeKey` completed inside the flap window.

The grouping layer keeps a `dedupeKey → {runId, completedAt}` map, written when a run
finishes (success or failure) and pruned lazily on read. At window-fire time it resolves the
most recent in-window predecessor across the group's keys and stamps it onto the
`GroupRecord`, persisted as `groups.previous_run_id` in the CLI's own store
(`prismalens-cli.db`, added via that store's `ADDITIVE_MIGRATIONS` path — the CLI store is
not Prisma-managed).

Unchanged by #231: the in-flight paths. A re-page whose fingerprint is already running still
attaches to the live run via `appendGroupAlert` and dispatches nothing; a *different*
fingerprint landing in a running group still attaches as a late alert.

Storm-grouping interplay — what should happen when a flapping alert and a storm overlap — is
deliberately left undesigned until a real workload asks for it.

---

## Scope note

"App side" in #231 means the **API `dedupKey` layer**. `appendGroupAlert` exists only in the
CLI; the API's closest analog is the dedup counter path, which is where R1 and R2 landed.
The CLI grouping path keeps its existing behavior apart from R4's linkage.

## Where the tests live

| Ruling | Spec |
| --- | --- |
| R1, R2a/b/c | `packages/api/src/modules/alerts/alerts.service.spec.ts` |
| R3 | `packages/api/src/modules/webhooks/webhooks.service.spec.ts` |
| R4 (+ in-flight baselines) | `packages/cli/src/cli/grouping.test.ts` |
