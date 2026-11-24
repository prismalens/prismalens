# Browser e2e

Playwright, driving the real app against fake alert and agent sources. CI runs it as `e2e-browser.yml`, called by the `e2e` job of `ci.yml` whenever the plan says the app or the UI changed; `CI gate` waits on it.

## Where things live

| Path | Holds |
| :--- | :--- |
| `e2e/features/*.feature` | Gherkin journeys |
| `e2e/steps/` | Their steps, plus `fixtures.ts` (the `test` they share) and `product.ts` (helpers that drive the product) |
| `e2e/journeys/*.spec.ts` | Plain Playwright specs, and the helpers they share (`settled.ts`, `verb.ts`, `by-hand.ts`) |
| `e2e/pair.setup.ts` | Pairs each stack's browser once |
| `e2e/stacks.ts` | The per-worker stacks, tested by `stacks.test.ts` under `pnpm test` |
| `e2e/pl-up/` | The packed-artifact specs |
| `e2e/bar/`, `e2e/sim/` | Specs that run against a sim, not a stack; see Sim specs |
| `e2e/conditions/helpers/` | Scripts the sim's conditions run |
| `scripts/fakes/` | The fake Alertmanager and fake ACP agent, shared with `packages/api/test/scenarios/` |
| `e2e/.features-gen/` | Specs `bddgen` compiles from the features; generated and gitignored |

## Writing a journey

A journey is a Gherkin scenario in `e2e/features/`. Steps speak only in what a user sees and does. Every precondition is made through the product (a webhook, a run, a click), never seeded or written to the database. The demo seed is there only for screens that read. A walk finding is fixed together with the journey that would have caught it.

`e2e/features/live-updates.feature` is the smallest example. A step fires an alert through the fakes:

```ts
When("Alertmanager fires {string}", async ({ alertmanager, deliverWebhook, unique }, name: string) => {
	alertmanager.fire({ labels: { alertname: unique(name), severity: "warning" } });
	await deliverWebhook(); // the app's real webhook, with the workspace's token
});
```

Fixtures from `steps/fixtures.ts`: `alertmanager`, `deliverWebhook`, `unique` (alert names unique per scenario, so parallel scenarios never see each other's), `agents` (install or hide the fake agents for one scenario), `release` and `hold` (let a held run go on to its report).

Tags:
- `@responsive` also runs the feature on the `Pixel 7` and `iPad (gen 7)` projects, nightly in `e2e-browser-mobile.yml`. Tag a feature whose layout matters on a phone.
- `@reset-data` marks a scenario that empties its stack (Settings, Reset data). The main run skips it; CI runs it alone, one worker, afterwards.
- `@quarantine` moves a test that passes only on a retry out of the blocking run; the rule is in `CONTRIBUTING.md`, "Browser e2e tier".

## The fakes

- `scripts/fakes/fake-alertmanager.mjs`: `fire(alert)` lists an alert, `clear(fingerprint)` drops it, `restart()` empties the list, `post(webhookUrl, token)` sends one v4 group notification (listed alerts firing, cleared ones resolved).
- `scripts/fakes/fake-acp-agent.mjs`: on PATH as `opencode` and `claude-agent-acp`, it replays a session from `scripts/fakes/sessions/`. The default is `success`. Put `fake-session:<name>` in an alert's name or annotations to pick another for that run; a follow-up reopens the same session. The files in that directory are the catalogue.

## Running

```bash
pnpm --filter @prismalens/frontend test:e2e                      # bddgen, then every dev-stack project
pnpm --filter @prismalens/frontend test:e2e --project=journeys   # the features only
pnpm --filter @prismalens/frontend test:e2e --workers=1          # one stack, serial
pnpm --filter @prismalens/frontend exec playwright show-report   # a local run writes the report and never opens it
```

On Linux where Chromium will not start for missing system libraries and you have no root for `playwright install-deps`, run `pnpm e2e:libs`. It fetches them into `e2e/.libs/` (gitignored) and prints the `LD_LIBRARY_PATH` line to export.

### Projects

`playwright.config.ts` defines them; `pair` runs first and the rest depend on it.

| Project | Runs |
| :--- | :--- |
| `chromium`, `journeys` | The specs and the features, minus `@quarantine` and `@reset-data` |
| `chromium-reset`, `journeys-reset` | The `@reset-data` ones |
| `chromium-quarantine`, `journeys-quarantine` | The `@quarantine` ones; CI runs them in a step that cannot fail the job |
| `Pixel 7`, `iPad (gen 7)` | `@responsive` features, nightly |
| `pl-up` | Only under `PL_UP_E2E=1` |

CI runs `chromium` and `journeys` in four shards, then the reset and quarantine projects.

### One stack per worker

Every worker owns an API, a Vite, and a workspace (its own SQLite database, pairing and fake-agent state) under one temp root. Worker *n* binds Vite to `3000+2n` and the API to `3001+2n`, and each stack is ready on its own startup line, not a port probe. Journeys mutate global state, so workers never share a stack.

- Workers: 2 locally (fewer on a smaller machine), one per CPU in CI. `--workers=N` or `PRISMALENS_E2E_WORKERS` sets it.
- The ports are fixed with `reuseExistingServer: false`, so a run takes down whatever holds them. Move the base ports beside `pnpm dev`:

  ```bash
  PRISMALENS_FRONTEND_PORT=3480 PRISMALENS_PORT=3481 pnpm --filter @prismalens/frontend test:e2e --workers=4
  ```

  `PRISMALENS_FRONTEND_URL` follows the frontend port; without it Better Auth rejects every sign-in with `Invalid origin`.
- `PRISMALENS_E2E_BUILT=1` serves a production build from the API's own port instead of Vite.
- The harness refuses a workspace inside `~/.prismalens`.
- Each stack's database is migrated and seeded (`PRISMALENS_SEED_DEMO=1`) before the run, and the browser is paired by `pair.setup.ts` with `pl pair --operator`. The dev auto-pair is off.

## Agents on PATH

An agent installed on your machine would answer the harness gate and turn a scenario into a real run. So the servers and the tests get a PATH of small wrappers for `node`, `pnpm` and `git`, the fake agents, and the OS base directories. If a real agent binary sits in one of those directories, the run stops and names it. `PRISMALENS_E2E_KEEP_PATH=1` runs with your own PATH instead.

## The `pl up` mode

A green dev-stack run says nothing about the shipped artifact: it never exercises single-origin serving, the SPA fallback, the copied first-party closure or boot-time migrations. `PL_UP_E2E=1` runs the `pl-up` project instead:

```bash
PL_UP_E2E=1 pnpm --filter @prismalens/frontend exec playwright test
```

`scripts/pl-up-e2e.mjs` packs the tarball (or takes `PRISMALENS_TARBALL`), installs it into a throwaway prefix (`PL_UP_PREFIX`), and runs `pl up` on `PL_UP_PORT` (default 3100) against an empty workspace, so first run is genuinely first run. It uses one worker and its specs run serially. The first spec pairs through the startup link `pl up` printed; the rest start from that cookie.

## Sim specs

Some specs run against a sim brought up with `pnpm sim up`, not a per-worker stack, with one worker since they share it.

- `e2e/sim/` runs under `playwright.sim.config.ts`: `pnpm sim up --profile bare`, then `pnpm exec playwright test -c playwright.sim.config.ts` in `packages/frontend`. CI runs it as `sim-specs` in `proofs.yml`.
- `e2e/bar/` holds the bar checks (`playwright.bar.config.ts`), run by `pnpm sim bar-checks`.

## Screenshots

No test compares pixels. Screenshot specs run on purpose and write to a gitignored directory, for a person or a judge to read:

- `pnpm --filter @prismalens/frontend ui:shots` runs `journeys/design-matrix.spec.ts` against a production build, writing `design-shots/matrix/`. Set `UI_SHOTS_DEV=1` to shoot the Vite dev server.
- `design-shots.spec.ts`, `inbox-shots.spec.ts` and `overview-shots.spec.ts` write only when `DESIGN_SHOTS=1`; `DESIGN_SHOTS_DIR` moves the output.

`ui:check` in `AGENTS.md` and `design/GUIDELINES.md` say when a UI change needs them.
