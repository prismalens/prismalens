# Testing

The rules every test is held to are in `AGENTS.md` → *Invariants*. This page is the how.

## When to write which test

Work test-first: new code ships with tests written at its public seams and at least 80% per-metric coverage. Vitest enforces it through per-glob `coverage.thresholds` (`packages/cli/vitest.config.ts`): when you add a module, add it or its directory to that map, since a new source file with no threshold entry is a missing test. Files that predate the map are exempt until touched.

A frontend unit test that reaches the API fails (`packages/frontend/src/test-setup.ts`): mock the hook or give the component the data it reads. Every PR touching `packages/frontend` ships or extends a spec covering its changed surface.

## Journeys and scenarios

Journeys (`packages/frontend/e2e/features/*.feature`) and the API lifecycle scenarios (`packages/api/test/scenarios/`) make every precondition through the product: an alert from the fake Alertmanager through the real webhook, a run by the fake ACP agent, an operator's click or API call. Nothing is seeded or written to the database by hand; the e2e stack's demo seed is only for screens that read. A walk finding is fixed together with the journey or scenario that would have caught it. How to write one, run the suite and read its reports: `packages/frontend/e2e/README.md`.

## Flaky e2e tests

A test that passes only on a retry is quarantined, not left to retry. Tag it `@quarantine` with a comment naming its open `bug` issue, one issue per test:

```gherkin
  # Quarantined: #891 - the inbox's new-alert-row journey passes on its first attempt
  @quarantine
  Scenario: A new alert's row appears without a reload
```

It then runs in the non-blocking `chromium-quarantine` and `journeys-quarantine` projects, and the issue closes only when the tag comes off. Every run lists its flaky and failed tests in the job summary.

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
