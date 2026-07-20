# Golden-incident scorecard

The Phase B.3 slice pulled forward from Phase F ([[roadmap-canonical]] open gap:
"B.3 can't be validated without evals"). Lives outside `src/` so it never ships in
`dist` — this is dev/CI tooling, not a runtime export of the package.

## What it measures

Five golden incidents (`fixtures/*.json`), each a synthetic-but-realistic
investigation transcript (`agent_step`/`tool_result` `CanonicalEvent`s, grounded in
plausible `prom`/`loki`/`kubectl` output) for a distinct SRE scenario:

1. `bad-deploy-rollout` — a bad release rolls out, error rate spikes right after.
2. `connection-pool-exhaustion` — a traffic surge exhausts a fixed DB connection pool.
3. `disk-full-node` — a retry storm fills a node's disk, evicting pods.
4. `upstream-timeout-cascade` — an upstream dependency degrades, tripping a circuit breaker downstream.
5. `config-change-oom` — a config change (cache size) drives steady memory growth to an OOM kill.

Each fixture's `expected.rootCauseKeywords` names what the top-1 hypothesis (ADR-0002
ordered-evidence — array position IS the rank) must mention; an optional
`expected.mustNotContain` guards against the transcript's built-in red herring (a
distractor tool_result — e.g. "CPU nominal" — that a lazy model might latch onto).

It drives the REAL `reduce()` (`../src/supervisor/synthesize.ts`) — the actual
map-reduce join, not a reimplementation.

## Two modes

- **Offline (default, what CI runs)**: `pnpm --filter @prismalens/engine eval`. NO
  live LLM call. This is honestly a plumbing smoke test, not a model eval: it checks
  every fixture schema-parses against the real `@prismalens/contracts` schemas,
  `buildTranscript` produces a sane transcript, and `scoreReport` correctly
  passes/fails canned reports. **It does not tell you anything about model quality.**

- **Live**: set `PRISMALENS_EVAL_LIVE=1` plus a provider credential
  (`OLLAMA_API_KEY` or `OPENAI_API_KEY` are checked first; `PRISMALENS_EVAL_PROVIDER`
  / `PRISMALENS_EVAL_MODEL` / `PRISMALENS_EVAL_API_KEY` / `PRISMALENS_EVAL_BASE_URL`
  override any provider). Runs `reduce()` for real against each fixture's transcript,
  scores the actual top-1 hypothesis, and prints a scorecard:

  ```
  PRISMALENS_EVAL_LIVE=1 OLLAMA_API_KEY=... pnpm --filter @prismalens/engine eval

  fixture                       result  top hypothesis
  bad-deploy-rollout            PASS    Bad deploy of v2.14.0 introduced a nil...
  connection-pool-exhaustion    PASS    DB connection pool (max_connections=100)...
  disk-full-node                PASS    A retry storm filled node disk with logs...
  upstream-timeout-cascade      FAIL    payment-service pods under memory pressure
  config-change-oom             PASS    ConfigMap cache.max_entries change caused...

  4/5 passed (threshold 4/5) — PASS
  ```

  Exits non-zero when fewer than `PRISMALENS_EVAL_THRESHOLD` (default `4`) of the 5
  fixtures pass.

## Paired A/B runner (raw vs prismalens)

`ab-runner.ts` (#68 Half A) is a separate instrument from the scorecard above — it
doesn't score anything; it captures the DELTA between two arms on the SAME live
firing incident:

- **Arm "raw"** (`runRawArm`) — a bare Claude Code harness (`runClaudeCodeBranch`)
  with the incident-response skill loaded and NO supervisor. Its diagnosis is just
  the terminal agent text.
- **Arm "prismalens"** (`runPrismalensArm`) — the full Tier-1 supervisor
  (`investigateIncident`) over a Claude Code harness that loads the SAME skill,
  yielding a structured `InvestigationReport` via `reduce()`.

Both arms rent the same harness, the same skill, and the same pinned Claude model
(`CLAUDE_MODEL`, default `claude-sonnet-4-5`) — the clean-ablation invariant, so the
delta isolates pure supervisor/reduce value. `runPairedAB` drives both arms
sequentially (raw then prismalens), re-fetching firing alerts immediately before
each arm for a per-arm incident-drift snapshot.

Automated scoring is deliberately out of scope here (Half B / sreforge #39): the
capture's `score` field stays `{ score: null, note: ... }` via the default
`unscored` oracle. If a scoring oracle is passed and it throws, the arm's capture
(report, cost, tokens, events) is still preserved — only the score degrades to a
`"oracle failed: ..."` note.

There's no CI entry point — this is a live, opt-in harness driven by
`sreforge-phase2-ab.test.ts`, gated on `OLLAMA_API_KEY`, a `SREFORGE_SUBSTRATE`
checkout, and Claude Code auth, so it skips (never fails) without that env:

```
set -a && . packages/@prismalens/engine/.env && set +a \
  && pnpm --filter @prismalens/engine exec vitest run sreforge-phase2-ab
```

It writes the side-by-side capture (both arms + shared incident metadata) to
`eval/captures/sreforge-phase2-ab-<scenario>.json` — a tracked directory (unlike
`eval/results/`, which is gitignored), since this is the capture the future public
"PrismaLens vs raw agent" table draws from — and logs a console summary with the
per-arm cost/tokens/time and the prismalens-minus-raw delta.

## Adding a fixture

Drop a new `NN-name.json` in `fixtures/` shaped like the others:

```jsonc
{
  "name": "your-scenario",
  "context": { /* InvestigationContext — ≥1 alert + telemetry */ },
  "transcriptEvents": [ /* CanonicalEvent[] — agent_step / tool_result, branchId "root" */ ],
  "expected": {
    "rootCauseKeywords": ["a phrase the correct top hypothesis must contain"],
    "mustNotContain": ["an optional red-herring phrase it must NOT contain"]
  }
}
```

`eval/fixtures.ts` schema-validates it against the real `InvestigationContextSchema`
/ `CanonicalEventSchema` at load time — a malformed fixture fails loud, not at
synthesis time. Re-run `pnpm --filter @prismalens/engine test` to cover it under the
offline plumbing suite (`scorecard.test.ts`), and, ideally, a live run before relying
on it as a regression gate.
