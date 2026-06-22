# MIGRATION — harvested currency → surviving persisted types

> Work-unit **004 — Harvest investigation methodology & quality rubric**, FR-4 + FR-6.
> This document is the **authoritative field-by-field map** between the harvested
> output currency (`InvestigationReport` / `Hypothesis` / `Finding` in this
> `methodology/` module) and the two **surviving persisted shapes**:
>
> - the agents-package result type — `../types/results.ts` (`InvestigationResult`,
>   legacy `Hypothesis` with embedded `Evidence[]`, `Recommendation`); and
> - the contracts persistence schema — `@prismalens/contracts` `schemas/investigation.ts`
>   (`InvestigationSchema`, `confidence: z.number().min(0).max(1).nullable()`, no band).
>
> 004 **owns the mapping only**. It writes **no Prisma migration** and **no runtime
> adapter** — those land in **001** (`InvestigationRunner` / persistence) and **002**
> (adapter registry, the new loop, the producer flip). See `spec.md` "Out of scope"
> and `plan.md` "Migration path".
>
> **OQ-1 default ratified here:** `InvestigationReport` is a richer **superset** of
> `InvestigationResult`, persisted via an **additive + downcast** path — NOT a
> destructive schema break. This was recorded as OQ-1 in 004's spec and the
> additive path is the default proposal carried into **002's plan** (`plan.md`
> D0.1 / "Migration path" step 1; pure-additive rollback). The superset fields that
> have no column today (`findings[]`, `ruledOut`, `coverage`, `band`) **drop or
> defer** on downcast (see §1.3); none of them block the existing storage boundary.

---

## 1. `InvestigationReport` → persisted shapes

### 1.1 → `InvestigationResult` (`../types/results.ts`)

Direct, lossless carries (same semantic field, additive only):

| `InvestigationReport` (this module) | `InvestigationResult` (`results.ts`) | Notes |
|---|---|---|
| `summary: string` | `summary: string \| null` | Widen to nullable on downcast; report always sets it. |
| `rootCause?: string` | `rootCause: string \| null` | `undefined → null`. |
| `rootCauseCategory?: RootCauseCategory` | `rootCauseCategory: RootCauseCategory \| null` | **REUSED** type (imported from `@prismalens/contracts/schemas`), identical enum — no remap. `undefined → null`. |
| `confidence: number` | `confidence: number \| null` | Same 0–1 scalar. Report always sets it; `null` only on the legacy producer. |
| `hypotheses: Hypothesis[]` (new) | `hypotheses: Hypothesis[]` (legacy) | **Element shapes differ** — see §2 for the per-hypothesis downcast. |
| `recommendations: Recommendation[]` | `recommendations: Recommendation[]` | **REUSED** `Recommendation` (imported from `../types/results.js`) — identical shape, no remap. |

Fields the **legacy `InvestigationResult` requires that the report does not carry** —
the downcast adapter (002/001) must **supply** these from the run context, not from
the report body:

| `InvestigationResult` field | Source on downcast |
|---|---|
| `investigationId: string` | Run identity — supplied by the runner (001), not part of report currency. |
| `status: "completed" \| "failed" \| "timeout"` | Loop/timeout outcome — derived by the loop (002); the report itself models success content, not run status. |
| `error: string \| null` | Run failure — from the loop; report has no `error` field (a failure surfaces as a `Finding` of type `error`/`fatal`, see §2). |
| `executionTimeMs: number` | Wall-clock — measured by the runner (001). |

### 1.2 → contracts `InvestigationSchema` (`schemas/investigation.ts`)

The persisted boundary the contracts schema represents:

| `InvestigationReport` | `InvestigationSchema` (contracts) | Notes |
|---|---|---|
| `summary` | `summary: string \| null` | Direct. |
| `rootCause?` | `rootCause: string \| null` | `undefined → null`. |
| `rootCauseCategory?` | `rootCauseCategory: RootCauseCategorySchema.nullable()` | Same enum, REUSED. |
| `confidence` | `confidence: z.number().min(0).max(1).nullable()` | **Persisted as a bare scalar — the schema has NO band column.** `band` is derived on read, never stored (§1.3 + §3). |
| `coverage.sourcesQueried` | `dataSourcesUsed: z.array(z.string()).nullable()` | Downcast: `coverage.sourcesQueried → dataSourcesUsed`. Partial — only the source list survives; `dataGaps`/`completeness` go to `dataQuality`/`rawOutput` (§1.3). |
| `coverage` (full) | `dataQuality: z.record(z.unknown()).nullable()` | The structured coverage (`dataGaps`, `completeness`) is the natural fit for the existing free-form `dataQuality` JSON bag — additive, no schema change. |
| `findings`, `ruledOut`, `hypotheses`, `band` | `rawOutput: z.record(z.unknown()).nullable()` | The superset trail has no first-class column; it **defers** into the existing `rawOutput` JSON bag until 002 decides whether to promote it to columns (OQ-1 follow-on). |

Recommendations persist via the **already-relational** path
(`InvestigationWithRelationsSchema.recommendations` / `CreateRecommendationInputSchema`),
not as an inline array — unchanged by this unit.

### 1.3 Superset fields — DROP vs DEFER on downcast

These four fields exist **only** on the harvested `InvestigationReport`; neither
`InvestigationResult` nor `InvestigationSchema` has a column for them. The OQ-1
**additive** default keeps them by **deferring** (round-tripping through an existing
JSON bag), never by a destructive break:

| Superset field | Disposition on downcast | Where it lands today |
|---|---|---|
| `findings: Finding[]` | **DEFER** | `InvestigationSchema.rawOutput` (JSON). The per-finding `source`/`confidence`/`relatedTo` graph (Principle VI/IX) survives as data; it is **not** yet a queryable column. |
| `ruledOut: RuledOut[]` | **DEFER** | `rawOutput` (JSON). The "what was considered and rejected" audit trail (Principle IX) is preserved but not indexed. |
| `coverage: Coverage` | **DEFER (split)** | `coverage.sourcesQueried → dataSourcesUsed` (typed column); `dataGaps` + `completeness → dataQuality` (JSON). |
| `band: ConfidenceBand` | **DROP** (recomputed, never stored) | Not persisted. `band` is **derived** from the stored `confidence` via `deriveBand()` on read — storing it would let it drift from `confidence` (the exact failure §3 supersedes). |

**No data loss on the additive path:** every superset field is either typed-mapped,
JSON-deferred, or deterministically recomputable. The downcast is forward-only
detail-shedding; the report remains the system of record (Principle IX), and the
persisted row is a queryable projection of it.

---

## 2. Legacy `Hypothesis` → new `Hypothesis`

Legacy (`results.ts`): `{ id, description, confidence, evidence: Evidence[], category?, reasoning?, createdAt? }`
— embedded `Evidence[]` structs, **no** contradicting evidence, **no** lifecycle status,
**no** iteration, **no** ID-referenced finding graph.

New (`./findings.js`): `{ id, statement, status, confidence, supportingEvidence: FindingId[], contradictingEvidence: FindingId[], testPlan?, refutationReason?, iteration }`.

| New `Hypothesis` field | From legacy | Disposition |
|---|---|---|
| `id: string` | `id` | Carry. |
| `statement: string` | `description` | **Rename** `description → statement`. |
| `confidence: number` | `confidence` | Carry. **Never compared raw** — classified by the band (§3). |
| `supportingEvidence: FindingId[]` | `evidence: Evidence[]` (embedded) | **LOSSY restructure.** Each embedded `Evidence` is promoted to a top-level `Finding` (type `evidence`, with `source`, `description`, `timestamp`) and the hypothesis keeps only its `FindingId`. The reverse downcast (new → legacy) re-inlines the referenced `Finding`s back into `Evidence[]`. |
| `contradictingEvidence: FindingId[]` | **NET-NEW** (no legacy field) | FR-2: mandatory currency. Empty `[]` when downcasting *to* legacy (legacy cannot represent it → **lossy on downcast**). |
| `status: HypothesisStatus` | **NET-NEW** (no legacy field) | FR-2 lifecycle (`proposed \| testing \| supported \| refuted \| inconclusive`). On upcast from legacy, default to `"proposed"` (or `"supported"` if it was the persisted root cause). **Lossy on downcast** — legacy has no status. |
| `iteration: number` | **NET-NEW** (no legacy field) | Which loop round produced/last-touched it. Default `0` on upcast. **Lossy on downcast.** |
| `testPlan?` / `refutationReason?` | **NET-NEW** | Optional; absent on upcast from legacy. **Lossy on downcast.** |
| — | `category?` | Legacy `category` maps to the report-level `rootCauseCategory` when the hypothesis is the accepted root cause; otherwise it is a hint with no new-hypothesis home. **Drop** (not part of FR-2 currency). |
| — | `reasoning?` | Folded into the supporting `Finding` descriptions / `statement`. **Drop** as a discrete field. |
| — | `createdAt?` | Per-`Finding` `timestamp` carries provenance instead. **Drop** at the hypothesis level. |

**Net-new fields (cannot round-trip through legacy):** `contradictingEvidence`,
`status`, `iteration`, `testPlan`, `refutationReason`, and the ID-referenced
(vs embedded) evidence model. A downcast to legacy `Hypothesis` **loses** all of
these; they survive only in the deferred `findings[]`/`rawOutput` trail (§1.3).
This is acceptable under OQ-1's additive path because the new module is the source
of truth and the legacy shape is an explicitly-legacy persistence projection
(`plan.md` "Complexity tracking").

`Evidence.type` (`metric \| log \| trace \| alert \| incident \| other`) has no
1:1 slot on `Finding` (whose `type` is the finding-role taxonomy
`hypothesis \| evidence \| observation \| ...`); the source-modality is preserved on
the promoted `Finding.source` string, not as a typed enum. **Lossy** for the enum,
preserved as a string.

---

## 3. SUPERSESSION (FR-6)

The confidence **band** (`CONFIDENCE_BAND` + `classifyConfidence` in `./confidence.js`)
is the **sole** accept/reject authority. Every call-site below **compares a confidence
value against a hand-written literal** and is therefore **SUPERSEDED**. None may
survive once its owning code path is rewritten under **002** (the producer flip).
SC-2 requires a repo-wide search to return **zero governing** literal-vs-confidence
call-sites after 002.

> Found via `grep -rnE "0\.8[^0-9]|confidence_threshold|confidenceThreshold"` plus a
> widened `\.confidence\s*[<>]=?|>=?\s*0\.[0-9]` sweep over `packages/**/*.ts`. The
> hits `scout-node.test.ts:185 similarity: 0.8`, `connection-pool.ts:79 riskScore: 0.8`,
> and `supervisor/format.ts:150 best.similarity > 0.7` are **NOT** confidence thresholds
> (similarity/risk scalars) and are **out of scope** of the band.

| # | Call-site | Current logic | Superseded by | 002 owning path |
|---|---|---|---|---|
| S1 | `prismalens-agents/src/core/config/schema.ts:49` | `confidence_threshold: z.number()...default(0.8)` — the engine's single accept/reject knob. | `CONFIDENCE_BAND = { auto: 0.85, corroborate: 0.7 }` (split into the two-edge band). | **Dropped, not mapped** — the retired-engine config is read-only reference (NFR-1, A-3). 002's `ConvergenceConfig` (this module's `./convergence.js`) deliberately **omits** `confidence_threshold`; the band owns it. |
| S2 | `packages/@prismalens/agents/src/agents/analyst/extract.ts:171` | `if (bestConfidence > 0.7) → recommend "resolver"` (HIGH-confidence accept → conclude). | `classifyConfidence(c)` — `"auto"` (≥0.85) ships; `"corroborate"` (≥0.7) needs `corroborationSatisfied()` (FR-7), not a bare `> 0.7`. | 002 retires the analyst node (LangGraph producer, ADR 0002 §1). The route-on-confidence decision moves into 002's grade-gate keyed to the band + corroboration. |
| S3 | `packages/@prismalens/agents/src/agents/analyst/extract.ts:182` | `if (bestConfidence < 0.4 && hasDataGaps) → recommend "gatherer"` (LOW-confidence reject → re-dispatch for more data). | `classifyConfidence(c) === "reject"` (and a `coverage` gap), producing a **negative signal with feedback** (FR-12), not a hardcoded `< 0.4`. | Same analyst-node retirement (002). The `0.4` is an unowned intermediate band that the 0.85/0.7 band replaces; re-dispatch becomes the convergence/grade negative signal. |
| S4 | `packages/@prismalens/agents/src/agents/resolver/format.ts:16` | `hypotheses.filter((h) => h.confidence > 0.3)` — drops low-confidence hypotheses from the rendered output. | The band's `"reject"` verdict (`< 0.7`) is the canonical "do not present as a conclusion" line; rendering filters on `classifyConfidence`, not `> 0.3`. | 002 retires the resolver node; report rendering (canvas/report, ADR 0002 consequences) adopts the band. |
| S5 | `packages/@prismalens/agents/src/evals/evaluators.ts:164` | `if (result.confidence !== null && result.confidence >= 0.3) score += 0.25` — eval scores a result "confidence reasonable" at a `0.3` floor. | The grading rubric (FR-9, `gradeReport`) keyed to the band: a sub-`0.85`-without-corroboration report is a **gap**, not a free quarter-point at `0.3`. | 002's grade-gate / eval harness replaces the ad-hoc `0.3` eval check with the structured rubric + band. |
| S6 | `@prismalens/contracts/schemas/investigation.ts:29,49,73` | `confidence: z.number().min(0).max(1).nullable()` on `ToolExecution`, `AgentExecution`, `Investigation` — a bare scalar with **no band**. | Persistence keeps the **scalar** (storage shape survives, A-2); the band is **derived on read** via `deriveBand()` — never a stored column (§1.3, "band DROP"). | 001/002 persistence: store `confidence` as-is, compute `band` at the boundary. **No schema change, no `band` column** in this unit (OQ-1 additive default). |

**Not a confidence threshold (excluded from supersession, documented for the SC-2 audit):**

| Excluded hit | Why it is not governed |
|---|---|
| `agents/analyst/prompt.ts:57` / `extract.ts:10-13` (doc-comments `>0.7`, `<0.4`) | Prose/JSDoc, not executable comparisons; removed with the analyst node (002). |
| `agents/supervisor/format.ts:150` `best.similarity > 0.7` | **Similarity** of a past incident, not investigation confidence. |
| `__tests__/.../scout-node.test.ts:185` `similarity: 0.8`, `scenarios/catalog/connection-pool.ts:79` `riskScore: 0.8` | Fixture **data values** (similarity/risk), not confidence accept/reject logic. |
| `agents/supervisor/node.ts` `h.confidence > best.confidence`, `utils/checkpoints.ts:79` | Confidence-vs-confidence **max-picking**, not a literal threshold — no band involvement. |

### Force-kill supersession (cross-reference, FR-12 / SC-5)

Not a confidence literal, but the same "002 must rewrite this path" list: the stall
guard in `agents/supervisor/node.ts` (`detectProgress()` → `goto "__end__"` with a
`compilePartialResult(state, "failed")` at lines ~144–152, mirrored at the iteration
guard ~134–141 and LLM-failure ~171–179) **force-terminates**, violating Principle III.
004's `./convergence.js` (`ConvergenceSignal = { type: "converged" \| "stalled", reason }`)
and `./events.js` (`StalledEvent` / `ConvergedEvent`) specify a **negative-signal-only**
contract; **002** replaces the `goto "__end__"` kill with re-dispatch-with-feedback,
terminating only on explicit timeout (`ConvergenceConfig.timeoutMs`).

---

## 4. Migration ownership summary

| Concern | This unit (004) | 002 | 001 |
|---|---|---|---|
| Type currency + field map | ✅ defines (this doc) | consumes / flips producer | — |
| Band as one symbol | ✅ `CONFIDENCE_BAND` / `classifyConfidence` | adopts at grade-gate | adopts at persistence-read |
| Supersede S1–S6 call-sites | ✅ enumerates | rewrites S2–S5 (node retirement) | S6 read-side `deriveBand` |
| Force-kill → negative signal | ✅ contract (`convergence.js`, `events.js`) | ✅ implements (deletes `goto "__end__"`) | — |
| Prisma migration / additive vs break | ❌ none | ⬚ OQ-1 follow-on (promote `rawOutput` fields?) | ✅ writes migration |
| Delete legacy `results.ts` `Hypothesis` | ❌ kept as legacy boundary (A-2) | ⬚ collapse (OQ-1) | ⬚ collapse (OQ-1) |

---

## 5. Open-question resolutions (004 → 002)

004 settles the defaults; 002 ratifies or revises in its plan.

| OQ | Question | Resolution in 004 | Left to 002 |
|---|---|---|---|
| **OQ-1** | `InvestigationReport` replace vs superset of `InvestigationResult`? | **Superset + additive/downcast** (ratified §1.3/§2; no destructive break). | Whether to promote the `rawOutput`-deferred trail (`findings`/`ruledOut`/`band`) to first-class Prisma columns. |
| **OQ-2** | Grade by deterministic checker, LLM-judge, or both? | **Deterministic structural checker** — `gradeReport` (rubric.ts) is the floor: structural, repeatable, never-throws (Principle III). | Optionally add an **LLM-as-judge second pass** *after* the structural gate (structural gate first, judge second). 004 ships only the deterministic floor. |
| **OQ-3** | "Independent" source = distinct `Finding.source` or distinct integration? | **Distinct `Finding.source`** (the integration key) — encoded in `corroborationSatisfied` / `corroboratingSourceCount` (confidence.ts). | Tighten to distinct integration *instance* (e.g. two Prometheus tenants) if needed. |
| **OQ-4** | Harvest `ChecklistItem` as a first-class persisted type? | **No — loop-internal only.** The "all criteria resolved" stopping condition is met by `gradeReport`'s gap set over the typed report; the engine's `ChecklistItem` is intentionally *not* re-authored and does not enter `InvestigationReport`. | 002 may keep an internal checklist inside the loop; it stays out of the persisted report. |
