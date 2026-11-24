# Testing

The rules every test is held to are in `AGENTS.md` → *Invariants*. This page is the how.

## When to write which test

The app changes weekly, so tests pin what a user or caller sees, not how the code does it today.

- A bug fix starts with a test that fails on the bug, at the highest seam that shows it (a journey, a route, a service's public method), then the fix.
- A feature may start as a spike. Before its PR is ready it has tests at its public seam or a journey for the behaviour it ships. Don't write tests first for internals the next change will move; a test that breaks on a refactor with no change in behaviour tests the wrong thing.
- Coverage shows a reviewer what is untested; it is not a target. Each package's floor in `vitest.config.ts` is a ratchet: raise it, never lower it. A new module needs no per-file entry.

## Unit and integration tests

- API product code reads time and signals through `packages/api/src/core/clock.ts` and `packages/api/src/infrastructure/dispatch/process-signals.ts`, so a test can fake them. Biome forbids a direct `Date.now()`, `new Date()`, `setTimeout`, `setInterval` or `process.kill` there.
- An api test's size is its file name. `*.spec.ts` is small: no real database, process, socket or git, a fake clock, and 1 s a test. `*.int.spec.ts` is medium: real SQLite, localhost and git, real timers, and a `vi.setConfig({ testTimeout })` of 3x its slowest test, at least 5 s. Biome forbids a `child_process` import in a small spec.
- A frontend unit test that reaches the API fails (`packages/frontend/src/test-setup.ts`): mock the hook or give the component the data it reads.
- On CI, an api or frontend test that spends over 40% of its timeout fails (`scripts/lib/timeout-budget-reporter.mjs`), and the api's tests run again with the clock 40 days ahead: use fake timers or a measured timeout, never today's date.

## Journeys and scenarios

Journeys (`packages/frontend/e2e/features/*.feature`) and the API lifecycle scenarios (`packages/api/test/scenarios/`) make every precondition through the product: an alert from the fake Alertmanager through the real webhook, a run by the fake ACP agent, an operator's click or API call. Nothing is seeded or written to the database by hand; the e2e stack's demo seed is only for screens that read. A walk finding is fixed together with the journey or scenario that would have caught it. How to write one, run the suite and read its reports: `packages/frontend/e2e/README.md`.

A new end-to-end behaviour of the core loop (an alert in, a report out, a restart between) is a core journey: write it once in `scripts/journeys/` as plain steps over the public HTTP API and the webhook, with no product imports, and every target runs it: in-process (`packages/api/test/journeys/journeys.int.spec.ts`), packed (`PACKED_INTAKE_AGENT=fake node scripts/packed-intake.mjs <tarball dir>`) and live (the pinned agent, nightly). What only one target can show, such as a clock jump or what the browser draws, stays a scenario or a `.feature`.

## Flaky e2e tests

A test that passes only on a retry is quarantined, not left to retry. Tag it `@quarantine` with its open `bug` issue on the same line, one issue per test:

```gherkin
  @quarantine #891
  Scenario: A new alert's row appears without a reload
```

It then runs in the non-blocking `chromium-quarantine` and `journeys-quarantine` projects, and the issue closes only when the tag comes off. `pnpm quarantine:check` (in CI's lint job) holds the limits and names every offender: each tag names an open issue, at most 5 tags exist, and each issue is under 14 days old. Past the limit, fix the test or delete it.

## The agent loop

A PR never waits on a live model, and nothing here spends money on one.

| Check | Model | Runs |
| --- | --- | --- |
| `test`, `packed-intake`, `packed-upgrade-smoke`, `gate-side-checks` | the scripted ACP agent, `scripts/fakes/fake-acp-agent.mjs` | on a PR that changes what they read (`ci.yml`, `proofs.yml`); side checks nightly and on a release PR |
| `harness-admission`: the admission (R1-R11) and the behaviour matrix, one leg per agent | the real pinned agent, its model calls served by aimock from `scripts/fakes/scenarios/` | nightly, a release PR, and a PR that touches an agent's launch inputs (`proofs.yml`) |
| protocol probe and pin bump | none | nightly and daily (`agent-release-watch.yml`) |
| `harness-admission-live`, `packed-intake-live` | the real pinned OpenCode on its free model | on dispatch with `live`, and before a release (`nightly.yml`) |

Tier-1 legs (opencode, claude-code, codex) gate; tier-2 legs (gemini, deepagents) do not. A row's `tested` version equals the pin CI installs (`scripts/agent-pins.json`, checked by `harness-pins.test.ts`) and moves only in a merged bump PR.

Run one agent's qualification with the agent on PATH at its pin:

```bash
pnpm --filter "@prismalens/contracts..." build
node scripts/admission-fake.mjs claude-code "$PWD" --repeat 3   # --only admission|matrix, --rows a,b, --journal
```

Each matrix row is one file in `scripts/fakes/scenarios/rows/`: the fixtures that script the model, the outcome PrismaLens must reach (`report`, `fault`, `error`, `exited`, `cancelled`, `cancelled-orphaned`), and any agent that legitimately differs, with its reason. A row passes on what the engine observed (its events, the files and processes the run left), never on model text.

To turn a user's failed run into a row, read its `transcript.jsonl` and write the model's steps (a tool call, a refusal, an HTTP status) as fixtures in your own words. `[row:<name>]` is the marker the matrix puts in the row's prompt; `$shell`, `$command`, `$incident_get` and `$report` stand for the agent's shell tool, its argument, the gateway tool and a valid report; every other key is aimock's. Then run it per agent with `--only matrix --rows <name> --journal`. Never commit an agent's request body (system prompt, tool descriptions): `scenario-fixtures.test.ts` fails on a request key or an overlong string.
