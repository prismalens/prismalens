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

Which oracle scores a run is selected from the environment, all-or-nothing:

- **rca-judge** (`rca-judge-oracle.ts`, Half B / sreforge #39) — the campaign
  scorer. Used only when `SREFORGE_REPO`, `SREFORGE_SCENARIO_DIR`, and
  `RCA_JUDGE_MODEL` are **all** set; see the Half B section below.
- **interim keyword oracle** (`interim-oracle.ts`) — the fallback when any of the
  three is missing. It still emits a plausible number, so **read the capture's
  `note` before trusting a batch**: a run that silently fell back is
  indistinguishable from a judged one at a glance.
- **`unscored`** — `runPairedAB`'s own default when no oracle is passed at all.
  The capture's `score` stays `{ score: null, note: ... }`.

If a scoring oracle throws, the arm's capture (report, cost, tokens, events) is
still preserved — only the score degrades to an `"oracle failed: ..."` note.

**Interim Keyword Oracle**: `interim-oracle.ts` is a path-A keyword scorer that predates the judge and now serves only as the fallback above. It reuses the exact substring-match logic from the scorecard to grade the `prismalens` arm's structured report, and applies the same raw string matching to the `raw` arm's terminal text (to avoid injecting any product structure into the baseline). Every score it produces clearly notes its interim status. **This oracle is quarantined and strictly throwaway**; it will be deleted once the judge is the sole scorer.

There's no CI entry point — this is a live, opt-in harness driven by
`sreforge-phase2-ab.test.ts`, gated on `OLLAMA_API_KEY`, a `SREFORGE_SUBSTRATE`
checkout, and Claude Code auth, so it skips (never fails) without that env:

```
set -a && . packages/@prismalens/engine/.env && set +a \
  && pnpm --filter @prismalens/engine exec vitest run sreforge-phase2-ab
```

It writes the side-by-side capture (both arms + shared incident metadata) to
`eval/captures/sreforge-phase2-ab-<scenario>[-<CAMPAIGN_RUN_ID>][-<n>].json` — a
tracked directory (unlike `eval/results/`, which is gitignored), since this is the
capture the future public "PrismaLens vs raw agent" table draws from — and logs a
console summary with the per-arm cost/tokens/time and the prismalens-minus-raw
delta. All eval captures are sanitized at write time (`sanitize.ts`) to redact credentials and normalize home paths before persistence.

**Set `CAMPAIGN_RUN_ID` for campaign batches.** The scenario slug is identical for
every cold run of a scenario, so without a run id each run competes for one
filename. The file is reserved atomically (`wx`), so a collision appends `-2`,
`-3`, … rather than truncating the earlier run — but the run id is what makes the
artifacts identifiable after the fact.

## Incident alert selection and capture naming

`pickIncidentAlerts` and `scenarioLabel` (`incident-selection.ts`) govern which firing alerts a paired A/B evaluation investigates and how the capture artifact is labeled.

### Environment variables and precedence

- **`INCIDENT_ALERTNAMES`** (comma-separated): Drives a **storm scenario** where grouping $N$ correlated alerts into one incident is the discrimination axis (sreforge#65). Returns all named alerts.
- **`INCIDENT_ALERTNAME`** (singular): Names a single alert for single-alert scenarios.
- **Precedence**: Setting **both** `INCIDENT_ALERTNAMES` and `INCIDENT_ALERTNAME` is invalid and throws an error (`"INCIDENT_ALERTNAMES and INCIDENT_ALERTNAME are both set — pick one."`).
- **Fallback (neither set)**: Defaults to the first firing alert (`alerts[0]`). While fine ad hoc, this fallback is dangerous in a campaign: armed stacks also fire load-plane noise (such as `EdgeClientRequestJitter`), and Alertmanager order is not incident order.
- **`INCIDENT_SCENARIO`**: Explicitly sets the capture label (slugified).

### Every-named-alert-must-be-firing rule

In both storm and single-alert modes, **every named alert must be actively firing**. If any specified alert is missing, `pickIncidentAlerts` throws an error naming the missing alert(s) alongside what was actually firing. A storm missing members is a different incident; quietly investigating an incomplete subset would evaluate the wrong problem while appearing to be a clean run.

### Capture-naming consequences

Without `INCIDENT_SCENARIO`, capture labeling falls back to slugifying the first incident alert (`slug(incidentAlerts[0].alertname)`). This causes issues:
1. Every booklogr scenario fires the same primary alertname (`BooklogrApiLatencyP99High`), so relying on the alert-slug fallback causes distinct scenarios to produce identical capture labels.
2. A multi-alert storm scenario has no single alert to be named after.

Therefore, setting **`INCIDENT_SCENARIO`** is what distinguishes captures across different scenarios in campaign runs.

## Half B — rca-judge oracle

`rca-judge-oracle.ts` (sreforge #39 Half B) wires sreforge's `rca-judge` into the paired A/B eval runner through the `ScoringOracle` seam. It invokes sreforge's judge tool (`tools/rca-judge/judge.mjs --judge`) in a temporary directory, passing the arm's terminal diagnosis (`rawText`) as `rca.md`.

It is armed by three environment variables:

- `SREFORGE_REPO`: absolute path to the local `sreforge` repository checkout. The judge runs with this as its working directory.
- `SREFORGE_SCENARIO_DIR`: the incident scenario directory — either absolute, or relative to `SREFORGE_REPO` (e.g. `use-cases/booklogr/scenarios/…`). The judge resolves `<scenario>/verify/oracle.md` against its own cwd, and exits 2 for the whole run if that file is not found.
- `RCA_JUDGE_MODEL`: model name passed to the judge (required by `--judge` mode).

The judge tool also reads optional environment variables:

- `OLLAMA_HOST` (default `https://ollama.com`)
- `OLLAMA_API_KEY`
- `RCA_JUDGE_TIMEOUT_MS` (internal judge model timeout, default `120000`)

Because `--judge` mode operates on a best-effort basis, if the judge model is unreachable or fails to parse after retries, the judge exits 0 without writing a `diagnosis.json` file. An absent score is treated as a normal state (`score: null`), recording the judge's stderr in the score's note. When `diagnosis.json` (`diagnosis.v1`) is produced, the score, rationale, and full structured axes (including `false_leads`) are captured into `ArmScore`.

Success is keyed on the **file**, never on the exit code: a valid `diagnosis.json` is honoured even if the judge exits non-zero (never discard a paid-for LLM verdict), and exit 0 on its own is not success. A `score` outside `[0,1]` is rejected as an invalid diagnosis rather than silently skewing the capture. The oracle never throws — every path returns an `ArmScore` — and the temp dir is always removed.

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

## Ablation ladder

The 4-rung ablation ladder (#220) decomposes agentic performance through the same Claude Code harness:

| rung | config | isolates |
|---|---|---|
| L0 | `maxTurns: 1`, ALL tools denied, no skill | the model alone |
| L1 | tools on, NO skill plugin | the agentic tool loop |
| L2 | tools on, incident-response skill on | domain knowledge (= today's raw arm) |
| L3 | L2 + prismalens supervisor | decompose/fan-out/reduce (= today's prismalens arm) |

### Environment contract & execution

`run-ladder.ts` drives a single scored rung out of the campaign path. It requires the following environment variables:

- `RUNG`: `L0`, `L1`, `L2`, or `L3` (required)
- `INCIDENT_ALERTNAME`: exact name of the firing alert to investigate (required — aborts if missing or not firing; never falls back to `alerts[0]`)
- `LADDER_RUN`: run index N (required)
- `INCIDENT_SCENARIO`: scenario slug name (required)
- `RCA_JUDGE_MODEL`: judge model name (required — aborts if judge config is missing; never silently substitutes a keyword oracle)
- `SREFORGE_REPO`: path to the local `sreforge` repository checkout (required for judge scoring)
- `SREFORGE_SCENARIO_DIR`: scenario directory relative to `SREFORGE_REPO` (required for judge scoring)
- `SREFORGE_SUBSTRATE`: substrate working directory (required)

### Output directory isolation

All ablation captures are written to `eval/captures-ablation/` (e.g. `ablation-<rung>-<scenario>-run<N>.json`) and NEVER to `eval/captures/`. This guarantees ablation runs can never be mistaken for or mixed with scored A/B campaign captures.

