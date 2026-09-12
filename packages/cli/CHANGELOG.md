# prismalens

## [1.0.0-rc.3](https://github.com/prismalens/prismalens/compare/v0.5.0-rc.3...v1.0.0-rc.3) (2026-09-12)


### ⚠ BREAKING CHANGES

* one ACP run per investigation, detect-and-report harness, deferred modules and pre-release lineage removed ([#621](https://github.com/prismalens/prismalens/issues/621))
* **release:** publish only prismalens — scoped packages bundled into the CLI ([#195](https://github.com/prismalens/prismalens/issues/195))

### Features

* **api,cli:** establish ruled dedup/flap-suppression semantics ([#231](https://github.com/prismalens/prismalens/issues/231)) ([#434](https://github.com/prismalens/prismalens/issues/434)) ([d3d84ae](https://github.com/prismalens/prismalens/commit/d3d84ae0f4ba798e156746df528161e59487954b))
* **app,worker,contracts:** storm path — correlated alerts fan out to one investigation ([#276](https://github.com/prismalens/prismalens/issues/276)) ([f2e96fa](https://github.com/prismalens/prismalens/commit/f2e96faa4686d6ba08d30ca4992f30306e726786))
* **cli,config:** config key casing, serve --sandbox parity, agent/synth model split ([#180](https://github.com/prismalens/prismalens/issues/180)) ([#183](https://github.com/prismalens/prismalens/issues/183)) ([0049fa8](https://github.com/prismalens/prismalens/commit/0049fa8c9801d0359870562bae35c6e0396765f7))
* **cli,config:** pl auth login/list/logout — stored credentials (ADR-0024 layer 3) ([#167](https://github.com/prismalens/prismalens/issues/167)) ([4636c9c](https://github.com/prismalens/prismalens/commit/4636c9c75b60d59651262faeaa3305007da38144))
* **cli:** 0.1.0 first-impression quick wins + one auto-selection order ([#154](https://github.com/prismalens/prismalens/issues/154)) ([27fa706](https://github.com/prismalens/prismalens/commit/27fa7063f40fc80beb7fbe431c17f3aa9f5f1924))
* **cli:** budget guardrails for pl listen ([#110](https://github.com/prismalens/prismalens/issues/110)) ([df29640](https://github.com/prismalens/prismalens/commit/df29640ae5c8ca6af4cea7bdf97170771b1393d9))
* **cli:** listen storm grouping — debounce window, coarse group key, attach-while-running ([#102](https://github.com/prismalens/prismalens/issues/102)) ([2c25539](https://github.com/prismalens/prismalens/commit/2c255398dc8c135c44382e3ec7228b25355436da))
* **cli:** pl listen walking skeleton — token-authed Alertmanager intake ([#99](https://github.com/prismalens/prismalens/issues/99)) ([0d1b430](https://github.com/prismalens/prismalens/commit/0d1b430145e6904d1551e24b1091a379987a1947))
* **cli:** pl up — the whole app as one process, from one npm install ([#237](https://github.com/prismalens/prismalens/issues/237)) ([#357](https://github.com/prismalens/prismalens/issues/357)) ([4c16af6](https://github.com/prismalens/prismalens/commit/4c16af6220ae75d67f2b75374f523fe8d36041ff))
* **cli:** slack delivery of listen reports ([#108](https://github.com/prismalens/prismalens/issues/108)) ([9d96a4d](https://github.com/prismalens/prismalens/commit/9d96a4d5fbb64b8323d1564420d578ac7c7b5964))
* **cli:** sqlite record store + pl status / pl report ([#103](https://github.com/prismalens/prismalens/issues/103)) ([b9f84e6](https://github.com/prismalens/prismalens/commit/b9f84e64d1cbcc79ff258ff54ce97c324a24a7a9))
* **contracts,engine,cli,db:** structured culprit + record identity/provenance stamps (ADR-0026) ([#267](https://github.com/prismalens/prismalens/issues/267)) ([6ee2531](https://github.com/prismalens/prismalens/commit/6ee25312be6b25fc5110a7ae4662d0d444f6054d))
* **database:** ship a migration runner and retire the squash-init policy ([#335](https://github.com/prismalens/prismalens/issues/335)) ([#354](https://github.com/prismalens/prismalens/issues/354)) ([7fdac79](https://github.com/prismalens/prismalens/commit/7fdac79e6bdac4acbf548793fdd4d74635e73957))
* **engine:** claude code default harness via registry SSOT ([#107](https://github.com/prismalens/prismalens/issues/107)) ([4d076ac](https://github.com/prismalens/prismalens/commit/4d076aca37772c65c2a8067c379d56deee580638))
* **engine:** contain mid-run harness aborts — partial report instead of run death ([#52](https://github.com/prismalens/prismalens/issues/52)) ([a336543](https://github.com/prismalens/prismalens/commit/a33654342ada1a337d77ec8b08d09e84da352bd8))
* **release:** publish only prismalens — scoped packages bundled into the CLI ([#195](https://github.com/prismalens/prismalens/issues/195)) ([d2ba9f4](https://github.com/prismalens/prismalens/commit/d2ba9f4a34fde107952d86b238ee0511159f45d7))
* **services:** map a Service to a local checkout, and run investigations there ([#331](https://github.com/prismalens/prismalens/issues/331)) ([#352](https://github.com/prismalens/prismalens/issues/352)) ([4e323ea](https://github.com/prismalens/prismalens/commit/4e323ea0bab44fe418ee033b73b791dfacf387b1))
* **worker,api,config:** harness auth routes and session discovery (Refs [#501](https://github.com/prismalens/prismalens/issues/501)) ([#507](https://github.com/prismalens/prismalens/issues/507)) ([36d5f43](https://github.com/prismalens/prismalens/commit/36d5f43b20247a1bc39b9ec4f3e59cfbbc3a3fac))


### Bug Fixes

* **cli,config,engine:** ADR-0024 credential resolver — provider selection, honest doctor, fail-closed config ([#149](https://github.com/prismalens/prismalens/issues/149)) ([a79f5ef](https://github.com/prismalens/prismalens/commit/a79f5ef42ff98f0a1a24d5559ae520f313ba81a1))
* **cli,config:** workspace-dir naming unification, flag-error output, path composition, registry model refresh ([#186](https://github.com/prismalens/prismalens/issues/186)) ([4bbb2b1](https://github.com/prismalens/prismalens/commit/4bbb2b197a684837847c181f78da8f71b54b9726))
* **cli,engine:** listen harness isolation — workspace scoping fail-closed + no host settings bleed ([#160](https://github.com/prismalens/prismalens/issues/160)) ([ed8ac21](https://github.com/prismalens/prismalens/commit/ed8ac210fbfdc57fe407f4f5c203e829248c8306))
* **cli:** give the session store its own file and refuse to rename app data aside ([#355](https://github.com/prismalens/prismalens/issues/355)) ([#387](https://github.com/prismalens/prismalens/issues/387)) ([1df7aed](https://github.com/prismalens/prismalens/commit/1df7aed62f204024ef0e8dac0cc8e5e0ec00967a))
* **cli:** listen bind host config + accepted-intake log line ([#165](https://github.com/prismalens/prismalens/issues/165)) ([bd40a4b](https://github.com/prismalens/prismalens/commit/bd40a4bf00fa8ad795c8e2a77e4c206baeb0ba0e))
* **cli:** listen dispatch robustness — re-page dedupe with key release + startup reaper with liveness guard ([#161](https://github.com/prismalens/prismalens/issues/161)) ([6a137ec](https://github.com/prismalens/prismalens/commit/6a137ecb9476c65056d855a883c61b10878b18cf))
* **cli:** log JSON-RPC invalid-params as WARN, not unexpected-error stack trace ([#306](https://github.com/prismalens/prismalens/issues/306)) ([dc3a4c8](https://github.com/prismalens/prismalens/commit/dc3a4c86a5e32a978e3441c3e43feec087126966))
* **cli:** replace invalid event kinds and obsolete report shape in sqlite-session-store tests ([#545](https://github.com/prismalens/prismalens/issues/545)) ([10726f6](https://github.com/prismalens/prismalens/commit/10726f616b28a02f68c088f87dbaa4fd2bbce6d2))
* **cli:** stale workspace schema no longer hard-crashes startup — back up and recreate ([#158](https://github.com/prismalens/prismalens/issues/158)) ([e19a42b](https://github.com/prismalens/prismalens/commit/e19a42b7e2ab8e1520b54d9960d74e44dae5e663))
* **cli:** UX quick wins from the 2026-07-11 audit ([#148](https://github.com/prismalens/prismalens/issues/148) items 1-7 + nits) ([#166](https://github.com/prismalens/prismalens/issues/166)) ([c824957](https://github.com/prismalens/prismalens/commit/c8249578fe55b22176140657c019374ca3d80d99))
* **engine,cli:** reduce pass-through + salvage — subscription-only runs get a raw report ([#141](https://github.com/prismalens/prismalens/issues/141)) ([f9dfc13](https://github.com/prismalens/prismalens/commit/f9dfc1354e62d57bca4e5cff9d814f008efa7c7c))


### Code Refactoring

* one ACP run per investigation, detect-and-report harness, deferred modules and pre-release lineage removed ([#621](https://github.com/prismalens/prismalens/issues/621)) ([d8c6e51](https://github.com/prismalens/prismalens/commit/d8c6e510ead55e58a4f6c04169f7b576bec67ea8))

## 0.5.0-rc.3

### Patch Changes

- 3ef7759: The dashboard banner, incident header, and detail tab now disable the investigate button when an investigation cannot start, displaying the exact reason instead of generic warnings. The banner is retitled "AI Investigations Unavailable" when a configured provider is unusable. (#521)

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
