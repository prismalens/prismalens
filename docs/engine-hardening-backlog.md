# Engine hardening backlog (M2 adversarial review, 2026-06-27)

> **⚠️ RESCOPED 2026-06-27 — architecture pivoted to the two-tier engine (ADR-0008:
> prismalens supervisor + rented harness, default deepagents).** Items that harden
> the *current in-process thin-loop runner* (most `API-*`, `ENG-1` checkpointer,
> `ENG-2` AI-SDK) are now **interim-only or superseded** — that runner is being
> replaced by Tier-1 supervisor + Tier-2 harness. Still valid regardless of engine:
> **frontend** items (`FE-*` — the drill-down/SSE consume the canonical stream either
> way), **contract/standards** (`FE-5`, `STD-*`), and **security** (`SEC-*` / ADR-0009,
> now enforced at the harness/MCP boundary). Treat `API-*`/`ENG-1`/`ENG-2` as "only if
> we keep the current runner in the interim."

Findings from the adversarial review of PRs #6/#7/#9 (the `@prismalens/engine`
loop, the in-process API runner, and the live UI), tiered by priority. Decisions
that govern this work: **ADR-0008** (keep thin loop · rent AI SDK · own
checkpointer) and **ADR-0009** (tool-exec security: credential + sandbox
boundary, capability-minimised loop) in the mage hub.

Severity = blast radius if shipped as-is. Each item: `ID · what · file · why`.

> **Do STD-1 first.** Encoding the four standards gates (below) into
> `CLAUDE.md`/`AGENTS.md` *before* the fix pass means the fixes come out at-bar,
> so there is less to re-review.

---

## P0 — merge-blockers for #9 (cheap, high-impact, embarrassing if shipped)

- **FE-1 · Wire the Cancel button** · `routes/_authenticated/investigations/$id/index.tsx`
  · The destructive "Cancel" button has no `onClick` — a dead control;
  `useCancelInvestigation` isn't even imported. Zero recovery affordance for a run.
- **FE-2 · Validate `rawOutput` + guard the report view + add a route error boundary**
  · `index.tsx` (`as unknown as EngineReport`), `EngineReportView.tsx`,
  `routes/_authenticated/.../$id` · A legacy/partial `rawOutput` (the legacy worker
  path is still intact) hits `report.hypotheses.length` with no guard → render
  throw → `RootError` replaces the **entire app**, not just the panel.
- **API-1 · Boot reconciliation for orphaned runs** · `investigation-engine.service.ts`
  (+ `OnApplicationBootstrap`) · A crash/restart mid-run leaves the row at
  `running` forever (no reconciliation exists), and the `CONFLICT` guard then
  blocks re-running it. Single-tenant ⇒ anything `running` at boot is orphaned →
  mark `failed`/`interrupted`.
- **SEC-2 · Invert the child-env scrub to an allowlist** · `shell-exec.ts` (`childEnv`)
  · The 5-name secret denylist silently leaks any other provider key — including
  the **`OLLAMA_API_KEY` currently in use** — into every spawned process. Build the
  child env from a known-safe allowlist instead. (ADR-0009)
- **API-3 · Fix the single-flight race** · `investigation-engine.service.ts` (`start`)
  · `running.add(id)` happens *after* two awaits, so a double-click/two tabs run
  two engine loops on one investigation. Add to the Set synchronously at the top.

## P1 — security model correction (ADR-0009)

- **SEC-1 · Demote the denylist; rewrite the header** · `shell-exec.ts` · Reframe the
  mutating-verb + metachar regex as a fast-fail UX guardrail, explicitly **not** the
  security boundary. The boundary is credentials + sandbox + capability-min.
- **SEC-3 · Resource/flag gating on `kubectl`** · `engine-allowlist.ts` + `checkCommand`
  · `kubectl get secrets -A -o json` and `--server/--token/--kubeconfig/--as` flags
  all pass today (only `args[0]` is checked). Deny secret resources and
  connection-override flags; give `journalctl` an explicit safe arg set.
- **SEC-5 · Ship a read-only RBAC manifest + sandbox doc** · `docs/` · Copy-paste
  least-privilege ServiceAccount (`get/list/watch`, no `secrets`) like
  HolmesGPT/k8sgpt, plus a recommended-sandbox doc (container, non-root,
  egress-restricted). Make scoped read-only creds the documented default.
- **SEC-4 · (doc) arbitrary file reads via `cat`/`tail`/`ls`** · `shell-exec.ts` ·
  No path sandbox: `cat /abs/path/.env` / the app's own creds DB are readable.
  Per ADR-0009 the boundary is the runtime sandbox, so **document** this; optional
  later: a path guard. Not a code blocker on its own.

## P2 — lifecycle & durability (ADR-0008)

- **API-2 · `writeEngineResult` must not swallow failure** · `investigations.service.ts`
  · It wraps the txn in `try/catch → return null` and `consume` ignores the return
  → a persistence failure leaves status stuck `running` with the report silently
  lost. Throw (or have `consume` check `null` → `failed`).
- **API-4 · Make Cancel actually abort + add a timeout** · `investigation-engine.service.ts`,
  `loop.ts`, backends · No `AbortController` anywhere; cancel only writes
  `cancelled`, the loop runs on and overwrites it `completed`. Thread an
  `AbortSignal`; add a per-request LLM timeout.
- **API-5 · Remove the relay replay-skip** · `stream-relay.service.ts` (`subscribe`)
  · The `replayCount` skip drops the next N genuinely-new live events for a
  mid-run subscriber (replay can't interleave, so the skip is wrong).
- **API-6 · Reset buffer on re-run** · `stream-relay.service.ts` (`emit`) · Emitting
  into a `done` buffer doesn't reset `done` or clear the 60s cleanup timer → late
  subscriber gets an immediate `done` and the old timer wipes the live run.
- **API-7 · Size the ring buffer / persist the event log** · `stream-relay.service.ts`
  · 50 < real run event count (15 steps × N tools) → truncated replay for late
  joiners. Size to `maxSteps × maxTools`, or persist the full event log per run.
- **API-8 · Validate API key in `buildBackend`** · `investigation-engine.service.ts`
  · Missing/blank key currently returns 200 then fails async; validate so it
  surfaces as a clean `BAD_REQUEST`.
- **API-9 · Make `consume` un-rejectable** · `investigation-engine.service.ts` · The
  `void`ed promise can still reject from `finally`'s `complete()`; wrap so the
  fire-and-forget can never become an `unhandledRejection`.
- **ENG-1 · Durable checkpointer on SQLite** · engine + API · Snapshot loop state
  (status, cursor, `messages[]`) after each StepEvent; resume by replay. Structure
  each iteration as a discrete step → matches DBOS's `@DBOS.step()` seam. (ADR-0008)
- **ENG-3 · Retry hygiene** · `http.ts` · Honour `Retry-After`, add jitter, treat
  429-on-quota as non-retryable (current fixed backoff amplifies quota burn).
- **ENG-4 · Loop robustness** · `loop.ts`, `shell-exec.ts` · Include `stdout` on
  non-zero exit (a NotFound probe is valid evidence, not "no progress"); only count
  true tool/transport errors as no-progress; dedup identical consecutive calls; add
  an overall token/wall-clock budget.
- **ENG-5 · Terminal event on backend throw** · `loop.ts` · A backend throw escapes
  the generator → the live stream dies with no `report`/error event. Wrap so the
  stream always terminates with a degraded report or error StepEvent. (pairs w/ FE-3)
- **FE-3 · Don't treat transient SSE errors as fatal** · `use-engine-investigation-stream.ts`
  · `onerror` closes the socket on every error, killing EventSource auto-reconnect;
  inspect `readyState` and only treat `CLOSED` as fatal.
- **FE-4 · Idempotent reducer (upsert by step)** · `use-engine-investigation-stream.ts`,
  `EngineStreamPanel.tsx` · Reducer appends unconditionally and rows key by
  `step.step`; replay (which the server does on every subscribe) would duplicate
  steps + collide keys. Upsert by step number — also the precondition for FE-3.

## P3 — contract integrity & polish

- **FE-5 · Shared zod wire contract** · `@prismalens/contracts`,
  `use-engine-investigation-stream.ts` · Engine types are hand-mirrored in the UI
  with no shared source and no runtime validation → silent drift on any rename.
  Define the SSE/report shape once as zod in `contracts`, infer both sides,
  `safeParse` each tuple. Closes the drift behind FE-2/FE-4. (Standards gate: STD-3)
- **FE-6 · Accessibility** · `EngineStreamPanel.tsx` · `aria-live`/`role=status` on
  the streaming + error rows, `aria-hidden` on decorative icons, label the
  Collapsible triggers.
- **FE-7 · Hide the stale report during re-run** · `index.tsx` · `stream.report ??
  rawOutput` shows the *old* report next to the fresh live panel until the new one
  streams in.

## P4 — provider offload (ADR-0008)

- **ENG-2 · Adopt the Vercel AI SDK as the default direct-model backend** · engine
  `backends/*`, `http.ts`, `providers.ts` · Replace the hand-rolled Gemini/OpenAI-
  compat backends + retry with the AI SDK (BYO-key, per-step streaming → StepEvent,
  `activeTools` allowlist + tool-approval). Keep the `ModelBackend` seam; harness
  backends (CC/Codex) remain a separate slot-in, never the orchestrator.

## P5 — standards automation ("review less"; do STD-1 first)

- **STD-1 · Encode the four gates in `CLAUDE.md`/`AGENTS.md`** · (a) validate at
  boundaries with zod, not `as` casts; (b) handle crash/cancel/reconnect/persist-
  failure, not just the happy path; (c) safety by construction, not denylist;
  (d) test the risky paths. Highest leverage — code comes out at-bar.
- **STD-2 · Lint-ban unsafe casts** · Biome rule against `as any` / `as unknown as`;
  CI fails on violation.
- **STD-3 · Wire types only in `@prismalens/contracts` (zod)** · forbid hand-mirrored
  wire types (implements FE-5 as a rule, not a one-off).
- **STD-4 · CI gates** · typecheck + test + a coverage ratchet on the critical paths
  (engine loop, allowlist, runner lifecycle) so risky code can't merge untested.
- **STD-5 · Machine-first-pass review on PRs** · run the adversarial review
  (`/code-review`) in CI / a GH Action so the bot does pass 1; humans adjudicate.
- **ENG-6 · Test the security + lifecycle paths** · the allowlist bypass class,
  `start()` concurrency, crash-orphan reconciliation, `writeEngineResult` failure,
  cancel-during-run, relay replay — none are covered today.

---

### Notes
- **Pre-existing reds (not from this work):** `service-discovery` API specs,
  `AcceptSuggestionDialog.tsx` typecheck, `getModels`/models.dev validation.
- The `gh api --method=DELETE` repo-delete exploit raised in review applies only
  if `gh` is added to the allowlist — **the shipped `engine-allowlist.ts` does not
  include `gh`/`curl`**, so it is not live today. Keep it out (SEC-3).
