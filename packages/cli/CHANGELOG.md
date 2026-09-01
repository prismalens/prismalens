# prismalens

## 0.5.0-rc.2

### Minor Changes

- f4fd672: Withdraw the per-agent LLM override capability: the `INVESTIGATION_AGENTS` roster, its
  settings UI, and the `agentOverrides` settings field are removed, not relocated. A
  two-tier-native successor is tracked separately (#130).

### Patch Changes

- 3084991: Enforce an explicit field whitelist when serializing the joined `service` relation on incidents in `serializeIncidentWithRelations`, preventing raw Prisma database columns (such as `tenantId` and `discoveryMetadata`) from leaking into API responses (#532).
- ea1ed30: Fix the `openapi:generate` script and the live `/api/openapi.json` endpoint, both of which used `@orpc/zod`'s zod-v3 `ZodToJsonSchemaConverter` against this repo's zod v4 contracts. The converter silently failed to recognize the schemas, producing an empty JSON schema for every route input and an `OpenAPIGeneratorError` for any route with dynamic path params (#547). Import `ZodToJsonSchemaConverter` from `@orpc/zod/zod4` instead.
- e38dd45: Fix worker child-process 401 errors when writing investigation status and timeline entries (#535). The worker's `create()` and `fail()` calls now reach the internal REST endpoints (`PATCH /internal/investigations/:id/status` and `POST /internal/timeline`) using `X-Internal-Secret`, instead of the session-guarded oRPC routes that always returned 401 for the unauthenticated child process. A second pre-existing defect is also corrected: the internal controllers' request bodies were silently undefined because the app boots with `bodyParser: false` (required for oRPC) and no body-parsing middleware was scoped to the internal routes; `InternalModule` now applies `express.json()` for those four controllers.
- 11c109e: ui: gate incidents list investigate buttons on harness readiness and render refusal reason (issue #520)
  
  - The Investigate buttons on the incidents list (`IncidentTable` and `IncidentDataTable`) now consume the same harness readiness and AI provider status as the detail page and picker. When no harness or provider is usable, the button is disabled and displays the remedy in a tooltip on hover.
  - Handled HTTP 412 server refusals when initiating investigations across the incidents list, incident detail page, and command center dashboard by rendering the specific server-provided refusal reason in the error toast rather than a generic error.
- ab0f098: Refuse unrunnable investigations server-side (#520, ADR-0031).
  
  - `POST /api/incidents/:id/investigate` evaluates `resolveHarnessSelection` before modifying status or enqueueing a job.
  - Returns HTTP 412 (`PRECONDITION_FAILED`) with typed refusal payload (`InvestigationRefusalSchema`) containing `failure`, `reason`, and `harness`.
  - Incident status remains unchanged and no worker job is enqueued when the selection is unrunnable.
- 3e89aab: Route worker investigation cancellation check and failure-handling writebacks through internal REST endpoints authenticated with `X-Internal-Secret` instead of session-guarded oRPC routes (#537). Add internal `GET /internal/investigations/:id` endpoint for the worker to verify investigation cancellation status before run execution. Remove dead `worker#lint` script from packages/worker (#529).

## 0.5.0-rc.1

### Patch Changes

- 36d5f43: Support CLI-session authentication routes alongside API keys for investigation harnesses (ADR-0031). Add Node-side `resolveHarnessAuth` to detect credentials and local CLI sessions (e.g. `claude` CLI logins) with truthful diagnostic remedies. Allow worker executions to run keyless with Claude Code harness when a CLI session is present, and add `GET /settings/harnesses` to report real-time harness readiness to the settings UI.
- e2dd887: Surface harness credential routes in the app (#501, ADR-0031).

  - **Settings → AI Provider → "Investigation agent".** Pick `Auto` or an implemented harness, each badged from `GET /settings/harnesses`: signed-in Claude session, API key, or not authenticated with the server's own remedy text. Pinning a harness whose credential is missing, or whose protocol does not match the active provider, shows the mismatch inline — PrismaLens never reroutes to a different harness, because that would change the read-only fidelity class behind the user's back.
  - **Setup wizard step 2.** When a usable `cli-session` verdict is reported, the step offers "Use your Claude subscription — no API key needed", which saves an anthropic provider config with no key and continues.
  - **Raw-report banner.** A report with `reportMode: "raw"` now says why it is unsynthesized and links to the provider settings. Keyed on the host-stamped field, never on text in the report body.

  Tell "not installed" apart from "not authenticated", and answer "would this run?" in one place (#518, closes #517).

  - **One shared gate.** `@prismalens/config/harness-selection` now owns the worker's job-time logic — provider-scoped key, protocol compatibility, harness setting, env override — and the worker, the setup-status predicate and the Settings picker all call it. They used to answer the same question from different inputs, which produced a badge saying usable for a job the worker refused, a warning against a working config, and a setup step going green on one that throws.
  - **Honest remedies.** `HarnessAuthVerdict` carries a `cause` (`not-installed` / `not-authenticated` / `not-implemented`), so a machine with no Claude Code is told the CLI is missing instead of being sent to run `claude /login`, which it does not have.
  - **Agents that cannot run are disabled** in the picker, with their reason on screen, and the card states plainly when no agent is available at all.

- 329e4f7: One harness-run predicate for keyless providers, signed-in CLI sessions, and model passing (#519, #525, ADR-0031).

  - **Keyless providers admitted (#519).** Local Ollama and custom endpoints declaring `requiresApiKey: false` now satisfy the harness gate's `api-key` route for `deepagents` without demanding a key.
  - **Signed-in CLI session auto-selection (#525).** Removed provider pre-filtering in auto-selection so a signed-in Claude Code CLI session (`cli-session` route) is selected regardless of the active synthesis provider.
  - **Harness-scoped model injection (#525).** Top-level harness request `model` is passed only when the active provider is one the selected harness speaks, preventing foreign model IDs (e.g. `gpt-...`) from being handed to Claude Code.

- 36d5f43: Fix worker oRPC client to speak OpenAPI REST routes instead of oRPC RPC procedure paths, matching NestJS `@Implement` endpoints (#511).

## 0.5.0-rc.0

### Minor Changes

- 08ae6ce: feat(api,frontend): mapping-health query + an honest "Alert Mapping Issues" card (closes #452, #294)

  - Adds `GET /alert-mapping/health` to compute mapping health across services and mapping rules over a configurable bounded window.
  - Distinguishes unmapped services, dead rules that have never matched any alert, and inactive rules that have stopped matching.
  - Replaces the hardcoded placeholder card removed in #284 with a live `Alert Mapping Issues` NeedsAttentionCard on the Command Center dashboard, querying the real issue total and linking to `/rules?tab=mapping`.
  - Surfaces unmapped services and inline rule health badges on `/rules?tab=mapping`.

- ea35428: Replace BullMQ/Redis with an in-process dispatch layer: a SQLite JobStore (claim / heartbeat / reclaim-as-rerun) and an EventBus carrying the SSE relay and cancel, under a global concurrency cap — Redis is no longer a dependency of running the app.
- 7fdac79: Ship a migration runner and retire the squash-`init` policy (SQLite app-data).

  The app now applies pending database migrations **programmatically at start**,
  from SQL packed inside the installed artifact — no `prisma` CLI, no `pnpm`, no
  schema source, none of which exist on a machine that ran `npm i -g prismalens`.
  A current database is a no-op; a partially-migrated one advances in place.

  Applying and recording are one `BEGIN IMMEDIATE` transaction, so concurrent or
  repeated runs converge and a crash mid-apply leaves nothing half-done. An
  existing populated database is backed up (`prismalens.db.bak-<epoch-ms>`) before
  any write, and a database whose history this build cannot account for — a
  downgrade, or an edited/squashed migration — is a hard stop with instructions
  rather than a partial apply.

  Migration history is **append-only from here on**. The development-phase rule
  that said to squash `init` and delete `prismalens.db` is removed from the repo's
  own instructions: following it once an installed database exists in the wild is
  data loss.

  **Upgrading an existing database:** `init` was edited in place three times before
  this rule existed, so a database created before those changes will stop with
  `checksum-mismatch` on first boot of this version. It is repairable in place —
  **do not delete the database.** The error message prints both checksums and the
  exact `UPDATE` to run; `CONTRIBUTING.md` → _Recovering a database that drifted_
  walks the whole procedure, including the DDL that must be applied alongside it.

- 4c16af6: `pl up` — run the whole app as one process on one port, from one npm install

  `npm i -g prismalens && pl up` now boots the NestJS API, serves the built
  dashboard from the same origin, creates a SQLite database in `~/.prismalens`
  and applies its own migrations. No Docker, no Redis, no second server.

  The tarball carries the first-party closure as **bundled dependencies**: a new
  `scripts/pack-cli.mjs` copies each built `@prismalens/*` package into
  `node_modules/@prismalens/<name>` and GENERATES the third-party dependency
  union those copies resolve against — because copying moves the hoist, it does
  not remove it. The pack fails on a version-range conflict between copied
  packages, or on any copied package importing something absent from the union.
  `packages/cli` no longer bundles the closure with `noExternal`.

  `engines.node` moves to `>=24`: `@prismalens/api` and `@prismalens/database`
  now travel inside this package and both require it.

- 4457339: frontend: a `/rules` screen for correlation and alert-mapping rules (#294)

  Correlation and alert-mapping rules existed only as API endpoints — twelve of
  them, with no way to reach any from the app. `/rules` gives them one screen with
  two tabs: list, create, edit, delete, and an enabled toggle per row, all
  round-tripping to the real endpoints and re-rendering from a refetch rather than
  local state. The action selector offers exactly the three actions the engine
  honours (`correlate`, `suppress`, `create_incident`), and the duplicate-name
  conflict from the server is shown in the dialog instead of being swallowed.

  Each tab also carries a _Test with sample alert_ dialog over the real
  `POST /correlation/test` and `POST /alert-mapping/test`. Those endpoints evaluate
  a sample alert against the **saved, enabled** rule set — there is no
  test-before-save, and the dialog says so rather than implying otherwise.

  Also fixes the alert-mapping list endpoint, which ignored its declared query
  input and hard-filtered to enabled rules: a rule you switched off vanished from
  the list with no way to switch it back on.

- 4e323ea: Service → local checkout mapping: investigations now run against your actual repo.

  A service can be pointed at a checkout on the machine running the worker
  (**Service detail → Repositories → Local checkout**), and the investigation's working
  directory is resolved from it per run — the incident's service first, then the firing
  alert's `service`/`namespace`/`job` label by exact name. `PRISMALENS_INVESTIGATION_CWD`
  is demoted from the primary mechanism to the unmapped escape hatch, and an unmapped run
  now says so in the worker log and on the incident timeline instead of silently reading
  whatever directory the worker happened to start in.

  Paths are validated server-side before they are stored — a path that does not exist, is
  a file, or is not inside a git work tree is refused at configuration time with the
  reason. The validation and the resolution order live in `@prismalens/config` alongside
  the CLI's `resolveRepoPath`, so `pl listen` and the app cannot drift apart; the CLI's
  `detect-repo` now delegates to that shared implementation.

- 0c50519: The first-run setup wizard now finishes the job. After creating the owner account it walks a new install through the two things an investigation cannot run without — an AI provider and a local code checkout — and then hands off to a first incident. Previously `pl up` dropped a new user on a dashboard with no model configured, no service mapped to a checkout, and no explanation of either.

  The wizard resumes correctly, because it keeps no progress of its own. `GET /setup/status` now reports each step (`owner`, `aiProvider`, `codeLocation`, `firstIncident`) derived from durable state — a user row, a stored credential, a service with a `localCheckoutPath`, an incident row — and returns the first incomplete one as `currentStep`. A reload, a sign-in bounce, or a different browser lands on the thing that is genuinely still missing instead of falling straight through to the dashboard as the old binary `account → complete` state machine did. `setupComplete` still means only "an owner exists", so it remains the auth gate and the later steps never lock anyone out of the app.

  The provider step is a composition over the existing **Settings → AI Provider** surface, so there is still exactly one credential path in the app: the key is encrypted with AES-256-GCM by the token vault and stored in the database. The CLI's own `auth.json` is untouched.

  Empty screens are no longer dead ends. The dashboard, incidents and alerts pages now name whichever setup step is outstanding and link to it, instead of describing a source of data the operator has not connected yet and offering nowhere to go.

### Patch Changes

- dc636b3: Add unique constraint on `Account(issuer, accountId)` for Better Auth 1.7 compatibility in both SQLite and PostgreSQL lineages (#461).

  - **Schema definition:** Added `@@unique([issuer, accountId])` to the `Account` model in both SQLite and PostgreSQL schemas.
  - **Additive migration:** Added `20260826180000_account_issuer_account_id_unique` creating the `account_issuer_accountId_key` unique index in both lineages, refusing to migrate and reporting offending rows if duplicate records are detected.

- 3c2a1e2: Agent nodes on the investigation canvas render with their assigned colours from a bounded palette, providing distinct visual styling in both light and dark themes (#408).
- cf89328: Adopt Better Auth 1.7+ by adding the required `issuer` column to the `Account` model and database schema (#456).

  - **Schema migration:** Added an additive migration (`20260823073903_account_issuer`) in both SQLite and PostgreSQL lineages adding the `issuer` column to the `account` table, with automatic backfill for existing credential accounts to `local:credential`.
  - **Dependency upgrade:** Unpinned `better-auth` in `pnpm-workspace.yaml` catalog from `~1.6.25` to `^1.7.1`.

- ea35428: Cancelling an investigation as it finishes no longer reruns it. The child disconnects its IPC channel the moment it has reported its result, while the runner deliberately withholds settlement until the child exits — so a cancel pressed in that window used to land on a closed channel, and the resulting error settled an investigation that had already succeeded as a retryable failure. A run that reported its verdict now keeps it.

  Cancelling a run that nothing holds no longer leaves the job behind to run again. When the cancel request finds no receivers after every grace retry, the API writes the terminal record itself; it now cancels the orphaned job row in the same step, so the stale-claim sweeper cannot return a user-cancelled investigation to the queue and overwrite its terminal state.

  The API container image now builds and ships `@prismalens/worker` and its workspace dependencies. The API forks that package as the per-run investigation child; it was absent from the image, so the child entrypoint could not be resolved and no investigation could start.

- 1df7aed: CLI: the session store gets its own file, and the recovery path refuses to touch application data (#355).

  - The CLI's SQLite session store now lives at `<workspace>/prismalens-cli.db`. It previously opened `<workspace>/prismalens.db` — the same file `@prismalens/config` hands Prisma for the application database. Because the store's schema-mismatch recovery renames its whole file aside and recreates it, any drift in the CLI's own five tables (`groups`, `runs`, `events`, `reports`, `group_alerts`) would carry a `pl up` user's incidents, investigations, services and postmortems away with it.
  - The rename-aside recovery now inspects `sqlite_master` first and refuses, with an error naming the file, the foreign tables and the safe action, if the file holds any table the CLI does not own. The check runs both before the first write and immediately before the rename, so the CLI neither creates its tables inside a database it does not own nor moves one aside.
  - Existing CLI run history inside a shared `prismalens.db` is **not** migrated: on a shared file the CLI's `events` table and Prisma's `events` table are the same name, so a copy cannot tell whose rows it is reading. The old file is left byte-for-byte untouched, and the CLI prints a one-time notice saying how many runs are in it and that they were not copied across.

  Nothing in `packages/api`, `packages/worker` or `packages/engine` reads the CLI's tables, so the split is behaviour-neutral for the application.

- 1992e30: The CLI documentation covers installation, quick start, and the registered command list, and directs to https://docs.prismalens.io for complete reference material and guides.
- ea35428: A dispatch loop can no longer run two children for one investigation. Claims are now owned by a token minted per attempt rather than per process, so a run whose job was reclaimed and re-claimed — including by the loop that is already running it, after its heartbeats failed for longer than the staleness cutoff — discovers on its next heartbeat that it was displaced, instead of heartbeating a claim that had been rewritten as itself. A loop handed a job it is already running now kills and silences the displaced attempt before starting its replacement, rather than overwriting its handle and leaving a child that nothing could kill, whose dying end-of-stream would have truncated the replacement's live stream.

  `PRISMALENS_DISPATCH_ENABLED=false` is refused at boot instead of quietly starting an API process that cannot serve the runs it accepts. The EventBus is in-process only, so a process that serves the API without running the dispatch loop streams no events and receives no cancel — and then writes a terminal state over a run that is still executing. The flag's description said the opposite; it now documents the constraint.

- 97ff6c2: engine: fence every untrusted-text surface reaching a Tier-1 prompt (#229)

  Extends #207's DATA-ONLY fence to the surfaces that predate it. Alert payloads
  (`alertname`, `severity`, `labels`, `annotations`, related alerts), the agent
  transcript (including raw tool-result previews), and the reduce-merge incident
  header now render inside fences built by one shared helper, so an attacker who
  can write an alert annotation or a log line can no longer address the model
  directly. Nothing is filtered or truncated — only the fence sentinels and the
  invisible characters that could rebuild them are neutralised, so an injection
  attempt still reaches the model to be reported. The engine README now carries
  the complete, closed list of untrusted surfaces.

- 10fc30d: Query-string boolean filters no longer invert: "false" now parses to false.
- e8fb49e: Correct the `IncidentWithRelations` type so it matches the rows the incident queries actually return — the joined `service` is the full Service row (`service: true`), and investigations carry `completedAt`. Adds a regression guard pinning both the query shape and the serialized payload's conformance to the oRPC output contract (#320).
- a35be21: Four storm-path follow-ups from the #276 pre-merge review (#302):

  - Worker: drop the redundant re-parse of the job payload and move the remaining `InvestigationJobDataSchema.parse` inside the persisting try/catch, so a schema-parse failure marks the investigation row `failed` instead of leaving it dangling `pending`.
  - Worker: include `**/*.test.ts`/`**/*.spec.ts` in `packages/worker/tsconfig.json`'s typecheck and fix the type errors that surfaced (storm-test alert literals missing `annotations`/`startsAt`, a fetch mock under-declaring its own signature, and `flush()` calls against the optional `InvestigationStore.flush` narrowed honestly instead of asserted away).
  - API: the auto-trigger path (`InvestigationTriggerService.triggerInvestigation`) now fetches and threads the incident's alerts into the job payload, matching the manual trigger path instead of silently relying on the worker's DB fallback.
  - API: `serializeAlert` in both the alerts and incidents controllers now whitelists response fields explicitly instead of spreading the raw Prisma row, which was leaking the dormant `tenantId` column (ADR-0011 §6) onto alert responses.

- cb26fd5: frontend: remove unrendered stubs, unused hooks, and hardcoded card (issue #284)
- 9fb7dbd: Harden the server bootstrap: Host/Origin allowlist middleware plus `helmet`.

  Every request's `Host` — and its `Origin`, when present — must name an allowlisted
  hostname or is rejected with `403`. This closes the DNS-rebinding class against the
  `@Public()` routes (login, session, and owner creation during the pre-setup window),
  which CORS cannot cover because a rebound page is same-origin to the browser. Loopback
  names and IP literals are always allowed, so the unconfigured local run and a LAN bind
  both work with no configuration; `PRISMALENS_ALLOWED_HOSTS`, `PRISMALENS_PUBLIC_URL` and
  `PRISMALENS_DOMAIN` extend the list.

  `helmet` now sets the standard hardening headers, including a CSP locked to `'self'` for
  every fetch directive, with two documented relaxations the statically served SPA requires.

  Also: `PRISMALENS_HOST` now defaults to `127.0.0.1` rather than `0.0.0.0`, and a
  non-loopback bind logs a warning; and the API no longer issues a cross-origin CORS grant
  to `http://localhost:3000` by default — under single-origin serving that grant named an
  origin that no longer exists. Set `PRISMALENS_CORS_ORIGIN` to opt back in.

- 494202a: Harden the integrations credential core: a provider response that returns 2xx without an access token is now rejected instead of storing a credential whose token is `undefined` (OAuth2 code exchange, OAuth2 refresh, and GitHub App installation-token exchange). Credential masking also matches snake_case and kebab-case field names such as `api_key` and `access-token`, which previously passed through unmasked. Adds the first test coverage for the credential vault, RS256 JWT minting, the OAuth2 authorization-code exchange, and concurrent token refresh (#253).
- cfe65fe: ui: create an incident by hand and investigate it, with no alert source wired (issue #286)

  `/incidents` now offers **Create Incident** — in the page header and in the empty state a
  fresh install actually lands in. The dialog calls the existing `incidents.create` procedure
  and routes to the new incident, where **Start Investigation** runs the ordinary investigation
  path on it. This is the demo journey for an install that has no Alertmanager pointed at it.

  Both Start Investigation affordances on the incident detail page now respect the same
  AI-provider gate; previously the Investigation tab offered a live button while the header's
  was disabled.

- 664c118: fix(frontend): React Flow minimap stays light in dark mode (#436)

  The React Flow minimap container, mask, and node fills now adapt to dark mode
  via app theme tokens and dynamic lightness calculation.

- 4c16af6: The API logs a boot warning when `NODE_ENV=production` resolves to non-secure cookies, so a deployment sitting behind a TLS terminator without `PRISMALENS_PUBLIC_URL` (or `PRISMALENS_PROTOCOL=https`) discovers the problem at startup rather than at the next silent logout.
- 494202a: integrations: never put a provider response body in a thrown error (#347)

  A non-2xx provider response used to be rendered into the error message
  verbatim, and the OAuth callback handler logs that error. A token endpoint
  routinely echoes what it was sent, so a bearer token, a refresh token, the
  authorization code or the client credentials could be written to logs — and on
  the refresh path, persisted on the connection row.

  The four call sites that did this — the OAuth2 code exchange plus the GitHub,
  Vercel and Render API clients — now share one helper that reads nothing from
  the response except the status code. The error still names the operation, the
  provider and the HTTP status, so a reader can still tell which call failed and
  why. The reason phrase is looked up from the status code rather than taken
  from the provider's `statusText`, and the OAuth `error` field is fenced against
  the codes registered in RFC 6749 §5.2 / RFC 8628 §3.5 rather than echoed;
  `error_description` is dropped. A malformed 2xx body no longer surfaces the raw
  `SyntaxError` either, since `JSON.parse` quotes the input it choked on — a
  truncated token response quotes the token.

  Regression tests assert that a sentinel secret placed in the body, the reason
  phrase, the OAuth error field or a truncated JSON body reaches none of the
  thrown error's message, string form, stack or serialized form.

- d3d84ae: Alert dedup and flap suppression get ruled, tested semantics across all three dedup layers (#231).

  Before this, the three layers that deduplicate an alert agreed on nothing, and none of them had a concept of a flap. A refire of a resolved alert bumped a counter and never reopened it, so a condition that came back minutes after resolving went permanently silent. New behaviour, keyed off one global knob `PRISMALENS_ALERT_FLAP_WINDOW_MINUTES` (default 15):

  - **API dedup is now status-aware.** On a `dedupKey` hit: an open alert (`triggered`/`acknowledged`/`correlated`) bumps the counter with its status untouched; a `resolved` alert refiring **inside** the flap window reopens to `triggered` and appends a "reopened by refire (flap)" timeline entry to its incident; a `resolved` alert refiring **outside** the window opens a genuinely new alert row, keeping episode history honest; a `suppressed` alert bumps the counter and **never** reopens — suppression stays forward-only (ADR-0028).
  - **`Alert.dedupKey` and `Alert.externalId` are no longer unique columns**, which the new-episode branch requires (a refired condition reuses its stable fingerprint). Additive migrations `20260812180006_alert_dedup_key_not_unique` and `20260822161331_alert_external_id_not_unique` swap the unique indices for plain ones in both the sqlite and pg lineages; reads (`findByDedupKey`, `findBySourceAlertId`) take the newest episode.
  - **The GitHub webhook path gets delivery-GUID idempotency**, matching the generic and Render paths. `processGithubWebhook` now routes through the same `ingestEvent` wrapper keyed on `X-GitHub-Delivery`, which GitHub reuses across redeliveries.
  - **CLI grouping records cross-run flap linkage.** A refire arriving after its investigation completed still starts a new run — nothing is resurrected — but the new run's group record now carries `previousRunId` when a prior run for the same dedupe key finished inside the flap window. Persisted via the CLI store's own additive-migration path; existing `prismalens-cli.db` files gain the column in place.

  Every ruled branch of these semantics is pinned by regression tests.

- 98400ac: Provider layer: one exact-templateId registry with segmented adapters (#446).
- 14586da: Completing the setup wizard now leaves you signed in. `POST /api/setup` created
  the owner through Better Auth server-side, so the `Set-Cookie` that a normal
  sign-in returns never reached the browser — the app looked authenticated until
  the first reload, which bounced a brand-new owner to the login screen. Setup now
  establishes the session through the same `/sign-in/email` route the login form
  posts to, and forwards its cookies on the setup response. The session is minted
  after the owner role is written, so Better Auth's signed session cache carries
  `role: owner` rather than the sign-up default.
- 916a6ba: Tell the reader when the live investigation stream drops and the page falls back to polling (issue #462: "fix(frontend): SSE failure shows a progress bar with no error signal, and the stream panel's own error chrome is unreachable").

  - Distinguish SSE transport failure from in-stream canonical error events so the polling fallback card renders only when the live connection actually drops.
  - Render in-stream error events inside the active investigation stream panel without claiming the connection is unavailable.
  - Resolve terminal stream status to `failed` when canonical error events were emitted before the `done` marker, displaying a distinct failure indicator in the stream panel header.
  - Give the polling fallback progress card an explicit affordance (`Polling` badge and `Live stream unavailable, polling for progress` status line) so readers understand the live connection is unavailable while the run continues polling in the background.
  - Remove the unreachable `status === "error"` branch and prop type from `InvestigationStreamPanel`.

- 333232d: The live investigation stream panel groups branches only when a run really fanned out, and stops fighting the reader's scroll (#280).

  - Branch chrome — the count badge and the collapsible per-branch sections — now keys off the number of distinct branches, not off the branch id being something other than `"root"`. A run with one branch named anything else was rendered as a fan-out: the badge read `1 branches` and the single branch was buried in a collapsible section instead of the flat list. Two ordinary paths hit that: a real fan-out emits `b0` before `b1` arrives, and a cancelled run's terminal event is stamped `supervisor`.
  - Auto-scroll follows new events only while the reader is at the tail. It previously forced the viewport to the bottom on every event, so scrolling up to re-read an earlier step during a live investigation was undone by the next event to arrive. Scrolling back to the bottom resumes following.
  - Opening a different investigation no longer inherits the previous one's stream. Changing the `$id` param re-renders the detail route in place rather than remounting it, so the panel carried its tail-follow state across — a reader who had scrolled up in one investigation found the next one silently not following its own tail — and the stream hook carried the previous run's events, rendering them under the new investigation until it produced its own. The panel is now keyed to the investigation, and the hook clears its state when it re-subscribes.

- ea35428: Investigation event streams now survive a run retry. A second attempt on the same investigation starts from a clean replay buffer instead of inheriting the finished attempt's, which had made a live retry report as inactive, replayed the previous attempt's events plus an immediate end-of-stream to every client that connected, and let the previous attempt's cleanup timer discard the live attempt's buffer mid-run. Completing a stream twice also no longer strands the earlier buffer-cleanup timer.
- 28546c8: A client that joins an investigation's live stream partway through no longer loses the first events it should have seen. The relay carried a counter that suppressed as many live events as it had just replayed, guarding against an event arriving in the middle of the replay — which cannot happen, because the replay is synchronous. The counter never dropped a duplicate; it dropped the first genuinely new events of every late joiner.

  Opening an investigation's stream more than a minute after the run finished no longer hangs. The relay treated "no buffer for this id" as "assume the run is live", so once a completed run's buffer expired the endpoint answered 200 with no events and never closed. The relay now distinguishes a live run from one it holds nothing for, and closes the stream immediately in the latter case.

  That close is deliberately not reported as a clean finish. The API holds its stream buffers in memory, so "nothing here for this id" is also what a still-running investigation looks like to a process that has just restarted or has not yet reclaimed the job — and answering that with the same end-of-stream marker a genuinely finished run gets would make the page show a live investigation as completed, with nothing left to correct it. The stream is now ended without that marker, which is what the investigation page treats as a lost connection: it falls back to polling the run's status and picks the real outcome up from there.

  An investigation that runs longer than ten minutes no longer has its live stream cut off. The relay's cleanup of abandoned buffers measured a run's total age, so at minute ten it closed the stream and stopped relaying a run that was still working, with nothing to reconnect it. Cleanup now measures silence instead: a run that is still producing events is never swept, however long it takes.

- a20f2e3: Un-suppressing an alert no longer dead-ends. `POST /alerts/{id}/correlate` used to
  re-suppress and answer `200` with no incident whenever an enabled `suppress` rule still
  matched — the caller was given no reason and no way forward. It now refuses with `409
CONFLICT`, naming the rule and the `PATCH /correlation/rules/{id}` call that unblocks the
  alert. The rule is never bypassed, so "suppressed by rule X" stays true.

  `GET /alerts/{id}` gains `suppressedBy` — the enabled rule currently holding a suppressed
  alert down, or `null` when nothing blocks re-correlation. It is derived from the live rule
  set on every read, never stored, so disabling or amending the rule clears it immediately.

  Also fixes a latent staleness bug: `runCorrelation` re-read the alert but evaluated the
  caller's copy, so a stale `status` could drive a redundant write through the suppress
  guard.

- c7a1339: UX-study bug fixes:

  - The alerts route honours `?tab=unmapped`, and the unassigned set (no incident, status `triggered` or `acknowledged` — `UNASSIGNED_ALERT_STATUSES`) is now resolved server-side by the new `AlertQuerySchema.unassigned` filter. Applying it in the browser windowed all statuses first, so the Unmapped tab could show fewer alerts than the dashboard counted whenever more than `limit` alerts had no incident.
  - The dashboard's "Unassigned" count reads `pagination.total` from that same filtered query instead of counting a capped page, so the count and the tab always agree.
  - `AlertQuerySchema`'s `hasIncident` filter parses the HTTP query string "false" as `false`.
  - `IncidentDetailPanel` now reads `rootCause` from the latest completed investigation rather than dropping it when a newer investigation is running or failed, while keeping the progress bar gated on the latest running investigation.
  - `incidents.list` selects multiple investigations so completed investigations remain available alongside in-progress or failed runs.

## 0.4.0

### Minor Changes

- d2ba9f4: prismalens is now the single published package; @prismalens/engine, config and contracts are bundled into the CLI and no longer published separately.

## 0.3.0

### Minor Changes

- 0049fa8: cli/config: normalize key casing, close the `serve` sandbox parity gap, and split the
  harness/reduce model knobs (#180, #148 items 8-11).

  - **Config key casing (item 8):** `telemetry` keys are now snake_case
    (`prometheus_url`, `alertmanager_url`, `api_url`) to match every other config key.
    No back-compat aliases (dev phase) — update your `prismalens.config.yaml`.
  - **`serve` `--sandbox` parity (item 9):** the JSON-RPC `investigate` method now accepts
    `sandbox` (validated against the sandbox modes; invalid ⇒ a JSON-RPC error, never a
    silent floor) and `maxTurns`, matching the `investigate` command's `--sandbox` /
    `--max-turns` (ADR-0020).
  - **`agent.model` split (item 11):** `agent.model` now sets the Tier-2 HARNESS model
    only; the Tier-1 reduce model is `synth.model` (ADR-0013/0016). `agent.model` no
    longer falls back into the reduce call, so a harness on one provider can't misroute
    the reduce call to another.

- 4bbb2b1: CLI UX fixes (issue #179): the storage directory is now consistently the "workspace directory" — env var `PRISMALENS_USER_FOLDER` → `PRISMALENS_WORKSPACE_DIR`, config key `workspace.base_dir` → `workspace.dir`, flag `--base-dir` → `--workspace-dir` (renames, no aliases); explicit env-var paths are used verbatim (no `.prismalens` suffix appended); invalid flags print the error + a one-line help hint instead of the full help dump; registry default models refreshed (incl. replacing Groq's `llama-3.3-70b-versatile`, EOL 2026-08-16, with `openai/gpt-oss-120b`).

### Patch Changes

- Updated dependencies [4bbb2b1]
  - @prismalens/config@0.3.0
  - @prismalens/contracts@0.1.1
  - @prismalens/engine@0.2.1

## 0.2.0

### Minor Changes

- 4636c9c: feat: add stored credentials support to CLI (`pl auth login`, `list`, `logout`) (#151)

### Patch Changes

- c824957: CLI UX quick wins: `--json` on `pl status`/`pl report`, unknown flags and config keys now warn/error instead of passing silently, readable config errors, explicit stdin parse errors, SQLite ExperimentalWarning suppressed, usage examples in `--help`.
- 5af6d68: Retire the "read-only" investigation claim from `pl investigate --help`: it now describes edit-tool removal as a guardrail, not a boundary, with the enforced `--sandbox` as the real one.
- 4636c9c: Degrade gracefully on permission errors in auth store; document pl auth.
- bd40a4b: fix(cli): wire --host through startup, expose bound host, token docs (#138)
- bd40a4b: Add `host` config option to `pl listen` and emit a structured log line on accepted webhook intake.
- c824957: Fix json error parity, own-property config check, and remove invalid any casts.
- Updated dependencies [4636c9c]
- Updated dependencies [6bbc048]
- Updated dependencies [4636c9c]
  - @prismalens/config@0.2.0
  - @prismalens/contracts@0.1.0
  - @prismalens/engine@0.2.0

## 0.1.1

### Patch Changes

- 6a137ec: Improves listener resilience by automatically reaping orphaned runs on startup and accurately suppressing duplicate investigations for re-paged alerts.
- e19a42b: Refine DB schema-recovery to only trigger on schema errors (ignoring operational errors), and extend validation to all schema columns.
- e19a42b: Fix issue where starting `pl listen` against a stale workspace DB hard-crashes at startup by automatically backing up the incompatible DB file and creating a fresh store.
- ed8ac21: Fix caps-slot leak on refused dispatch and record refusals in session store.
- Updated dependencies [ed8ac21]
  - @prismalens/engine@0.1.1

## 0.1.0

### Minor Changes

- 3b99bdc: Budget guardrails for `pl listen`, so an alert storm can't fan out into unbounded investigations. Three new `listen` config keys cap dispatch: `max_concurrent` (default 2) and `max_per_hour` (default 10, a rolling 60-minute window) gate whether a group is investigated, and `max_turns` bounds an individual Claude Code run. Over-cap groups are recorded as terminal `suppressed` runs with a suppression reason — visible in `pl status`, filterable with `--status suppressed` — rather than dropped silently. A suppressed run is not retried, since intake has already acknowledged the alert.
- 3b99bdc: `pl status` and `pl report` join the CLI, backed by a new `node:sqlite` record store (#60). Investigation runs, alert groups, events, and reports now persist to a WAL-mode SQLite database in place of the old JSON session files — no new native dependency, since it uses Node's built-in `node:sqlite` (which raises the CLI's Node floor to `>=22.13.0`, checked at startup). `pl status` lists runs and takes an optional `--status` filter; `pl report <id>` prints a stored report, adding the run's event timeline with `--events`. Failed runs now record their error reason instead of dropping it.
- 3b99bdc: `pl listen` now sends a best-effort Slack notification when a group investigation finishes — successful, no-evidence, and errored runs all notify (an errored 3AM run is exactly what you want woken for); operator-cancelled runs don't. Set the single `listen.slack_webhook_url` config field to enable it; leave it unset and nothing is sent. Delivery is fire-and-forget with a 5s timeout and no retries, and a failed post can never change a run's outcome — it emits one structured `slack_delivery_failed` line and nothing more.
- a79f5ef: Credential resolution and CLI safety fixes (#142–#147):

  - Unified credential resolution for all LLM providers per ADR-0024: precedence env → `_FILE` → none; the config file carries provider/model selection only (`synth.provider`, `synth.model`, `synth.base_url`), never secrets. `_FILE` values get exactly one trailing newline trimmed; a missing `_FILE` target is a hard error. Tier-1 is no longer hardcoded to ollama — `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, and `GROQ_API_KEY` now work, auto-selected in registry order when `synth.provider` is unset.
  - `pl doctor` stops guessing: it reports the resolved provider and source layer, and proves the credential is callable via a live ping (skip with `--no-ping`); broken or unparseable config is now a red failure naming the file, never green-with-warn.
  - Explicit `--config <path>` fails closed on missing, unreadable, or invalid files before any dispatch — a stated config can no longer be silently ignored while a token-burning run proceeds on defaults.
  - New `agent.max_turns` config key and `--max-turns` flag bound `pl investigate` runs the same way `listen.caps.max_turns` bounds listen-dispatched ones.
  - One canonical Ollama base URL per placement, with `/v1` appended in exactly one place; the never-read `PRISMALENS_OLLAMA_BASE_URL` env var is gone.
  - Missing `listen.token` prints one actionable error instead of a stack trace.
  - Engine contract: `SynthesisModelConfig` gains a required `configured: boolean` (set by the host from the resolver outcome; the engine stays env-clean).

- 2c25539: Adds alert storm grouping to `pl listen`. Firing alerts arriving close together are now debounced (default `listen.grouping_window_ms` of 60000ms) into a single group using a coarse key ladder (Alertmanager's `groupKey`/`groupLabels` if present, else `alertname` + service label, else alert labels, else a fallback). One investigation is dispatched per group carrying the full multi-alert context. Alerts arriving while their group's investigation is already running attach to it (deduped by fingerprint or label hash) instead of triggering redundant runs. Group metadata is recorded as a `GroupRecord` with `formedBy: "window"`.
- 0d1b430: New `pl listen` command (Phase 1 R1, #58): a token-authed local HTTP receiver
  for Alertmanager webhooks. Each firing alert triggers a full investigation —
  config, repo, and sandbox resolved per payload — with the report written to the
  run workspace. Invalid payloads get a 4xx with the validation reason; a bounded
  intake queue 503s overflow so Alertmanager's retry absorbs alert storms.
  Configure via the new `listen: { port, token }` section (`pl init` scaffolds
  it, `pl doctor` checks it).

### Patch Changes

- 27fa706: Suppress SQLite ExperimentalWarning on DB actions, strictly reject unknown CLI flags uniformly across commands, add help examples for listen, investigate, and doctor commands, and print absolute file paths with human-readable formatting when config schema validation fails.
- f9dfc13: Fix subscription-only `pl listen`/`pl investigate` runs producing no report (#131, #132). The Tier-1 reduce/synthesis step is the only direct model call in an investigation; with no provider key it fell back to the keyless cloud endpoint, 401'd, and the run was marked errored with nothing persisted — even though the harness's diagnosis was already gathered. Now: when no Tier-1 provider is configured the supervisor skips the model call entirely and persists the harness's submitted branch conclusion(s) as a report clearly marked raw/un-synthesized (#131); and when the reduce model call throws for any reason, the same raw report is salvaged with the synthesis error surfaced in it rather than erroring the run (#132). `pl listen` prints one startup line noting reports will be raw pass-through until a provider is configured (a supported subscription-only path, not a failure). No schema change; raw reports flow through the existing done/finish path and render in `pl report` and Slack.
- Updated dependencies [3b99bdc]
- Updated dependencies [a79f5ef]
- Updated dependencies [f9dfc13]
  - @prismalens/engine@0.1.0
  - @prismalens/config@0.1.0
  - @prismalens/contracts@0.0.2

## 0.0.2

### Patch Changes

- a336543: Harness failure containment + WSL-aware sandbox selection. A mid-run harness abort
  (e.g. deepagents killing its whole turn on one tool exception) no longer kills a
  single-branch run: the branch is respawned once in a fresh session, and if that also
  aborts, the failure becomes the branch's terminal `error` event and the reduce step
  still synthesizes a partial report from the evidence already gathered. Setup failures
  before the first event (binary missing, init handshake) still propagate. The
  investigation prompt now pins file reads/searches to the repository working directory
  (deepagents' filesystem tools follow model-supplied absolute paths outside the
  workspace root), and `deepagents-acp` is invoked with an explicit `-w <repo>` since it
  ignores the ACP `session/new` cwd. On WSL, the `auto` sandbox now floors directly as
  an expected degrade (calm info log, no per-run warning, no wasted egress probe — srt's
  bridge is unreliable under WSL in both networking modes); `--sandbox srt` still forces
  enforcement.
- Updated dependencies [a336543]
  - @prismalens/engine@0.0.2

## 0.0.1

### Patch Changes

- 0621354: First public release. The `prismalens` CLI (bins `prismalens` + `pl`) and its
  library closure — `@prismalens/engine`, `@prismalens/contracts`,
  `@prismalens/config` — publish to npm as 0.0.1 under Apache-2.0.
- Updated dependencies [0621354]
  - @prismalens/engine@0.0.1
  - @prismalens/contracts@0.0.1
  - @prismalens/config@0.0.1
