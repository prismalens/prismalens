# Alert deduplication, grouping & flap behaviour

What counts as "the same alert" in PrismaLens, what window governs that judgement, and what
happens when an alert flaps.

There are **two independent paths**, and they share no code, no key derivation and no window:

| | Path | Entry point | Where dedup lives |
|---|---|---|---|
| **CLI** | `pl listen` — Alertmanager webhook → investigation | `packages/cli/src/cli/grouping.ts` | In memory, for the lifetime of the process |
| **App** | `POST /alerts` → incident correlation | `packages/api/src/modules/alerts/alerts.service.ts`, `.../correlation/correlation.service.ts` | In the database |

They disagree in ways that matter — see [Where the two paths diverge](#where-the-two-paths-diverge).

> This page states behaviour **as it is**, not as it should be. Several rules below are wrong;
> each is labelled and linked to its follow-up issue. Every rule here is pinned by a test, so a
> change to the behaviour breaks a test on purpose. Established under
> [#231](https://github.com/prismalens/prismalens/issues/231).

---

## CLI path — `pl listen`

### The two keys

Every firing alert is reduced to two independent keys. **Group key** decides *what is
investigated together*; **dedupe key** decides *what is the same alert*.

`deriveGroupKey(alert, payload)` — first rule that applies wins:

| # | Condition | Group key |
|---|---|---|
| 1 | `payload.groupKey` is a non-empty string | that string, verbatim |
| 2 | `payload.groupLabels` has at least one key | `sha256` of the sorted `k=v` pairs |
| 3 | the alert resolves a service label | `"<alertname>\0<service>"` |
| 4 | the alert has any labels | `sha256` of the sorted `k=v` pairs |
| 5 | otherwise | the literal `"default"` — **every such alert shares one group** |

`deriveDedupeKey(alert)` — first rule that applies wins:

| # | Condition | Dedupe key |
|---|---|---|
| 1 | `alert.fingerprint` is a non-empty string | that string, **and nothing else** |
| 2 | otherwise | `alertname + sha256(sorted labels) + startsAt` |

Rule 1 is the one that runs in production: Alertmanager stamps `fingerprint` on every alert.
Two consequences follow directly, and both are pinned:

- **Labels are ignored when a fingerprint is present.** Two alerts with nothing else in
  common are the same alert if the sender reuses a fingerprint.
- **`startsAt` only matters when a fingerprint is absent.** For a fingerprinted alert, a
  re-fire at a new `startsAt` is the *same* alert. For an unfingerprinted one it is a
  *different* alert. There is no way to get both behaviours from one sender.

### The state machine

A group key moves through three states. `windowMs` is `listen.grouping_window_ms`
(default `60000`, clamped to 1 000–120 000 ms).

```
   IDLE ──first alert──► WINDOW_OPEN ──windowMs elapses──► RUNNING ──investigation ends──► IDLE
                              │                               │
                     more alerts buffer              more alerts append
                     (nothing recorded)          (one group_alerts row each)
```

What an arriving alert does depends on the state of its group **and** on whether its dedupe
key is already in flight anywhere:

| Arriving alert | Group state | What happens | Recorded? |
|---|---|---|---|
| New dedupe key | IDLE | Opens a window, starts the `windowMs` timer | Yes — as a formative alert at window close |
| New dedupe key | WINDOW_OPEN | Buffered into the same window | Yes — as a formative alert at window close |
| New dedupe key | RUNNING | Attached to the running investigation | Yes — `appendGroupAlert`, `late=1` |
| **Dedupe key already in flight** | WINDOW_OPEN | **Dropped** | **No** — no row, no log, no counter |
| **Dedupe key already in flight** | RUNNING | Dispatch suppressed | Yes — `appendGroupAlert`, `late=1`, **every single time** |

The suppression check runs **before** the group check, and the in-flight registry is keyed on
the dedupe key alone. So an alert is suppressed by an in-flight alert in a *different group*,
and is then filed under that other group's run — it never opens a window of its own.
([#397](https://github.com/prismalens/prismalens/issues/397))

### What counts as a "window" for suppression

Two different windows are easy to confuse:

| Window | Length | What it governs |
|---|---|---|
| Grouping window | `listen.grouping_window_ms`, default 60 s | How long alerts accumulate before one investigation is dispatched |
| Suppression window | **the lifetime of the in-flight investigation** — unbounded | How long a repeat of the same fingerprint is stopped from dispatching a second investigation |

The suppression window is not a duration anyone configures. It opens when the alert is first
admitted and closes when the investigation finishes (or when the process shuts down). A
five-second investigation gives five seconds of suppression; a forty-minute one gives forty
minutes.

### Flap suppression: there is none

No cooldown, no repeat-count cap, no rate limit, no hysteresis. The moment a run ends, its
dedupe keys are released and the very next delivery of that fingerprint dispatches a fresh
investigation. An alert that flaps on a cycle longer than its investigation gets **one
investigation per cycle, indefinitely** — bounded only by the dispatch caps
(`listen.caps.max_concurrent` / `max_per_hour`), which are a global budget, not a per-alert
one.

### Worked example

`grouping_window_ms: 60000`. Alertmanager has `repeat_interval: 1m`. One alert,
`fingerprint: fp-1`, on a service whose investigation takes three minutes.

```
t=0s     fp-1 fires
         → group "HighLatency\0web" IDLE → WINDOW_OPEN, 60s timer armed
         → activeAlerts[fp-1] = { phase: "window" }

t=30s    fp-1 re-delivered (repeat_interval)
         → activeAlerts has fp-1 → DROPPED. No row. No log line. Nothing counted.

t=60s    timer fires
         → runId = <uuid>; writeGroupRecord(runId, { alerts: [fp-1@t0], lateAlerts: [] })
         → group RUNNING; activeAlerts[fp-1] = { phase: "running", runId }
         → investigation starts

t=90s    fp-1 re-delivered
         → suppressed from dispatch, BUT appendGroupAlert(runId, alert) → group_alerts row #2 (late=1)

t=150s   fp-1 re-delivered  → group_alerts row #3 (late=1)
t=210s   fp-1 re-delivered  → group_alerts row #4 (late=1)

t=240s   investigation ends
         → activeAlerts[fp-1] deleted. No cooldown.

t=270s   fp-1 re-delivered
         → nothing in flight → new window, new timer

t=330s   SECOND investigation dispatched for the same alert
```

Net after one alert firing continuously for five and a half minutes: **two investigations**
and **four `group_alerts` rows** (one formative, three late) — three of which are
byte-identical re-deliveries. The row count is a delivery count, not a distinct-alert count.
The one drop at t=30s left no trace at all.

### The store does no deduplication whatsoever

`SqliteSessionManager.appendGroupAlert` is a plain `INSERT` with `late = 1`. There is no
unique constraint on `(group_id, payload)` and no upsert. All CLI-side dedup lives in the
in-memory grouping layer; the store records whatever it is handed.

One consequence worth knowing: `writeGroupRecord` **deletes every `group_alerts` row for the
run** before re-inserting. The listen path is safe today only because it writes the record
exactly once, at window close, before any append can happen. A future overlay or re-form path
that re-writes the record would silently erase the re-page history.

---

## App path — `POST /alerts` → incidents

Two stages run in sequence: alert-level deduplication, then incident-level correlation.

### Stage 1 — alert deduplication

`AlertsService.create` computes `dedupKey = sha256(source : title : severity : serviceId)`
(first 32 hex chars) and looks it up on the **unique** `Alert.dedupKey` column.

| | |
|---|---|
| **Key** | `source`, `title`, `severity`, `serviceId` — those four fields, nothing else |
| **Ignored** | `description`, `labels`, `tags`, `rawPayload`, `sourceUrl`, `externalId` |
| **Window** | **None.** The lookup carries no recency bound at all |
| **On a hit** | `occurrenceCount++`, `lastOccurrence = now`, `updatedAt = now` — and nothing else |

Because the key ignores the alert body, two alerts about different hosts carrying different
numbers collapse into one row. Because it *includes* severity, a flapping alert that escalates
`medium → critical` splits into a second row with `occurrenceCount: 1`.

**The flap hole ([#398](https://github.com/prismalens/prismalens/issues/398)).** The dedup
update does not touch `status` or `triggeredAt`. So an alert that was resolved and fires
again:

1. stays `status: "resolved"`,
2. is therefore skipped by `findUncorrelated()` (which filters `status: "triggered"`),
3. never re-enters correlation, so no incident is raised for the second episode,
4. and keeps its original `triggeredAt`, so correlation's 60-minute windows go on measuring
   from the *first* sighting — an alert first seen two hours ago can never fingerprint-
   correlate again, however recently it last fired.

The symptom is a quiet one: a flapping service produces exactly one incident, ever. Nothing
errors.

### Stage 2 — correlation into incidents

A four-tier waterfall; the first tier that produces an answer wins. Full rule semantics,
precedence and the un-suppression path are in
[Alert correlation & suppression](./alert-correlation.md). What matters here is the windows
and the match predicates:

| Tier | Window | Matches on | Configurable? |
|---|---|---|---|
| 0 | — | Alert already has an `incidentId` | — |
| 1 — rules | `rule.timeWindowMinutes` (default 60) | Incident is open, in window, **same service** | Window: yes. Predicate: no |
| 2 — fingerprint | **hardcoded 60 min** | Another alert with the same `fingerprint`, already on an incident, in window | No |
| 3 — time window | **hardcoded 60 min** | Any open incident, **same service** | No |
| 4 — new incident | — | Nothing matched | — |

Two boundary rules are surprising enough to spell out:

- **Tier 2 is skipped entirely when the alert has no `fingerprint`** — there is no fallback
  to title or labels. The alert goes straight to tier 3.
- **A serviceless alert widens the match instead of narrowing it**
  ([#399](https://github.com/prismalens/prismalens/issues/399)). Tiers 1 and 3 spread the
  service predicate conditionally, so an alert with `serviceId: null` produces a query with no
  service filter and is attached to the newest open incident of *any* service.

Also worth knowing: a tier-1 rule's `matchCriteria` selects the *rule*, never the *incident*.
`findMatchingIncident` filters on status + window + service only, so a rule that matched
because `severity: ["critical"]` attaches the alert to whatever open incident the service has
— then stamps `correlationRuleId` on it, so the audit trail claims the rule chose it.
([#399](https://github.com/prismalens/prismalens/issues/399))

### Flap suppression: there is none here either

Correlation reads neither `occurrenceCount` nor `lastOccurrence` nor any repeat history. On
this path "suppression" means exactly one thing: an **enabled correlation rule with
`action: "suppress"`** (see [#312](https://github.com/prismalens/prismalens/issues/312) and
ADR-0028). That is rule-based muting, not flap detection — it is derived from the live rule
set on every read and has no notion of how often an alert has fired.

---

## Where the two paths diverge

| Question | CLI (`pl listen`) | App (`POST /alerts`) |
|---|---|---|
| What is "the same alert"? | The Alertmanager `fingerprint`, alone | `sha256(source:title:severity:serviceId)` |
| Does the alert body affect identity? | No (fingerprint wins) | No (not in the key) |
| Does severity affect identity? | No | **Yes** — a severity change is a different alert |
| Does `startsAt` affect identity? | Only when there is no fingerprint | Never — not in the key |
| How long does dedup remember? | Until the in-flight investigation ends | **For ever** — no recency bound |
| Where does state live? | Process memory; lost on restart | The database; survives everything |
| What survives a listener restart? | Nothing — all suppression is forgotten | Everything |
| What does a duplicate produce? | A `group_alerts` row (running) or nothing (window) | `occurrenceCount++` on the existing row |
| Is there a repeat counter? | No — you count rows, and only the running-phase ones | Yes, `occurrenceCount` |
| Grouping window | 60 s debounce, configurable | 60 min correlation, hardcoded (except tier 1) |
| What does "suppressed" mean? | A dispatch cap tripped (`max_concurrent` / `max_per_hour`), the alert's repo could not be resolved, or a fingerprint is already in flight | An enabled rule said `action: "suppress"` |
| Flap handling | None | None |

The `suppressed` overload is the sharpest edge: `pl status` showing `suppressed` means a cap
or an in-flight duplicate, while an alert with `status: "suppressed"` in the API means an
operator wrote a rule. **The two have nothing to do with each other.**

Nothing reconciles the two paths. A deployment running `pl listen` *and* the app ingests the
same alert twice, under two different identities, with two independent dedup memories.

---

## Wrong-but-pinned

Pinned as-is by #231, filed for a decision the operator has not yet made:

| # | What | Path |
|---|---|---|
| [#397](https://github.com/prismalens/prismalens/issues/397) | Re-pages append without bound; fingerprint suppression crosses group boundaries; window-phase drops are invisible | CLI |
| [#398](https://github.com/prismalens/prismalens/issues/398) | A resolved alert that fires again is never revived, so a flapping service yields one incident ever; dedup has no recency bound | App |
| [#399](https://github.com/prismalens/prismalens/issues/399) | A serviceless alert joins an unrelated incident; a rule's criteria never reach the incident query; the 60-minute windows are hardcoded in three places | App |

## Where the tests are

Every rule on this page is pinned by an executing test. Break the behaviour and one of these
goes red — that is the point.

| File | Suite |
|---|---|
| `packages/cli/src/cli/grouping.test.ts` | `#231 dedup identity: deriveDedupeKey`, `#231 dedup/flap semantics of the grouping layer` |
| `packages/cli/src/core/sqlite-session-store.test.ts` | tests 15b, 15c |
| `packages/api/src/modules/alerts/alerts.service.spec.ts` | `#231 dedup semantics` |
| `packages/api/src/modules/correlation/correlation.service.spec.ts` | `#231 grouping windows and boundaries` |
