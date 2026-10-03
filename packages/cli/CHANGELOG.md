# prismalens

## [0.5.1](https://github.com/prismalens/prismalens/compare/v0.5.0...v0.5.1) (2026-10-03)


### ⚠ BREAKING CHANGES

* **harness:** supported agents on their own sign-in, no safety verdict, no placement ([#634](https://github.com/prismalens/prismalens/issues/634)) (#707)
* **auth:** no account on the instance; the host pairs through a startup link ([#698](https://github.com/prismalens/prismalens/issues/698)) (#701)
* remove the sandbox providers and every promise about them ([#682](https://github.com/prismalens/prismalens/issues/682))

### Features

* [#673](https://github.com/prismalens/prismalens/issues/673) readiness: pairing proven on the packed tarball, fidelity line, stranger-repo replay ([#711](https://github.com/prismalens/prismalens/issues/711)) ([280c2e8](https://github.com/prismalens/prismalens/commit/280c2e85d666c31b9e40cc4c2d90af90b7ff6021))
* a run reads every repo the incident touches, and a finished investigation takes a follow-up in the same session ([#747](https://github.com/prismalens/prismalens/issues/747)) ([#751](https://github.com/prismalens/prismalens/issues/751)) ([905b8da](https://github.com/prismalens/prismalens/commit/905b8da26a39bd29382a1574b87f9fdc07e1b246))
* **alerts:** an incident resolves when no connected Alertmanager lists its alerts any more ([#605](https://github.com/prismalens/prismalens/issues/605)) ([#728](https://github.com/prismalens/prismalens/issues/728)) ([0e9c74b](https://github.com/prismalens/prismalens/commit/0e9c74b32a52251d17055aa26617bc3848df8348))
* **auth:** devices pair with the host ([#698](https://github.com/prismalens/prismalens/issues/698)) ([#700](https://github.com/prismalens/prismalens/issues/700)) ([5fea4ec](https://github.com/prismalens/prismalens/commit/5fea4ecb4a17eae59413d646c96bed0c65219087))
* **auth:** no account on the instance; the host pairs through a startup link ([#698](https://github.com/prismalens/prismalens/issues/698)) ([#701](https://github.com/prismalens/prismalens/issues/701)) ([c8f9ea6](https://github.com/prismalens/prismalens/commit/c8f9ea6f4a9f8f9cb8fa00ff533f64e1f34c119b))
* Claude Code on a laptop runs on the user's own sign-in ([#663](https://github.com/prismalens/prismalens/issues/663)) ([35df29e](https://github.com/prismalens/prismalens/commit/35df29e915a0da3b098cb2734275930eee001d29))
* **cli:** a failed service upgrade rolls back to the previous version and database ([#766](https://github.com/prismalens/prismalens/issues/766)) ([#770](https://github.com/prismalens/prismalens/issues/770)) ([ccf3624](https://github.com/prismalens/prismalens/commit/ccf362409be0e0b7fcdaf16d098ecc85e1eb7dc4))
* **cli:** pl service runs PrismaLens in the background on Linux and macOS ([#732](https://github.com/prismalens/prismalens/issues/732)) ([#735](https://github.com/prismalens/prismalens/issues/735)) ([0f88ed0](https://github.com/prismalens/prismalens/commit/0f88ed0936940339f977139bdc87fb01487cf519))
* **cli:** reach the box from anywhere over Tailscale HTTPS ([#765](https://github.com/prismalens/prismalens/issues/765)) ([#768](https://github.com/prismalens/prismalens/issues/768)) ([db4d899](https://github.com/prismalens/prismalens/commit/db4d899267a24c23330ebd40863c6f79b61bbf10))
* close an incident, export the report as Markdown, pl reset, update notice ([#661](https://github.com/prismalens/prismalens/issues/661)) ([8bd230a](https://github.com/prismalens/prismalens/commit/8bd230a493e422451035578f5460d18c9cc44210))
* **desktop:** a branded window frame with native controls in the app's colours ([#736](https://github.com/prismalens/prismalens/issues/736)) ([#737](https://github.com/prismalens/prismalens/issues/737)) ([96b99b4](https://github.com/prismalens/prismalens/commit/96b99b40d86d565b8dd1269b010f5c707586425d))
* **desktop:** the Electron launcher spawns the backend and adds presence ([#83](https://github.com/prismalens/prismalens/issues/83)) ([#702](https://github.com/prismalens/prismalens/issues/702)) ([2199435](https://github.com/prismalens/prismalens/commit/2199435e1826941859e9f1859be3aacd5326d150))
* filter the services list by team ([#671](https://github.com/prismalens/prismalens/issues/671)) ([f8319ff](https://github.com/prismalens/prismalens/commit/f8319ff795abf78ec56679d583a3af480eb1ef4a))
* **frontend,brand:** the refraction mark in the app, a favicon, and the new banners ([#703](https://github.com/prismalens/prismalens/issues/703)) ([d809685](https://github.com/prismalens/prismalens/commit/d809685371591c7eacfb5f64529933feada7f560))
* **frontend,desktop:** production UX pass on web and desktop; the mobile top bar fits 375px ([#723](https://github.com/prismalens/prismalens/issues/723)) ([#726](https://github.com/prismalens/prismalens/issues/726)) ([32fb7c6](https://github.com/prismalens/prismalens/commit/32fb7c660215b963bdc0d4002f1650983ae20f4a))
* **frontend:** a run strip, bounded incident cards, a chat conversation with its box, and the board ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#750](https://github.com/prismalens/prismalens/issues/750)) ([5fba10a](https://github.com/prismalens/prismalens/commit/5fba10a690f7d7108958b11cd3a4afc037fdad89))
* **frontend:** one sidebar, incident tabs, and an Overview that opens with a summary ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#748](https://github.com/prismalens/prismalens/issues/748)) ([da22975](https://github.com/prismalens/prismalens/commit/da229753cda2ba26d9c19422600afdc9b5d73f1c))
* **frontend:** one visual system and one shell — sidebar doors, Back everywhere, Alerts and devices redesigned ([#779](https://github.com/prismalens/prismalens/issues/779)) ([85636b3](https://github.com/prismalens/prismalens/commit/85636b3727ea38f8798d9a3edfe5bf12be9f41e4))
* **frontend:** Settings sections, Alert sources, Services on one page and the agent picker ([#781](https://github.com/prismalens/prismalens/issues/781)) ([75ae038](https://github.com/prismalens/prismalens/commit/75ae038b64def06bd25d6b0bf0da8ed69f3d3d2a))
* **frontend:** the board, first run, Analytics and one-step Resolve ([#780](https://github.com/prismalens/prismalens/issues/780)) ([266d896](https://github.com/prismalens/prismalens/commit/266d89667bee82505fbcdc9bc412a4c663fddf57))
* **frontend:** the reshape — 32 surfaces to 17 ([#523](https://github.com/prismalens/prismalens/issues/523)) ([#694](https://github.com/prismalens/prismalens/issues/694)) ([4685bca](https://github.com/prismalens/prismalens/commit/4685bcac073438474b7b9679c58233491b2827c1))
* harness admission as data — SDK types, version in the record, per-row sign-in and model, Windows shims ([#681](https://github.com/prismalens/prismalens/issues/681)) ([b64ea46](https://github.com/prismalens/prismalens/commit/b64ea46be4c970b843cff254b1a9fa41814ebc43))
* **harness:** a model catalogue, models per agent, drift logged, a run refuses what the agent lacks ([#639](https://github.com/prismalens/prismalens/issues/639)) ([#704](https://github.com/prismalens/prismalens/issues/704)) ([2c968a2](https://github.com/prismalens/prismalens/commit/2c968a2e086275fdd1a1f7902c677eaaeb7ba405))
* **harness:** Gemini CLI never loads the incident repo's own config ([#634](https://github.com/prismalens/prismalens/issues/634)) ([#755](https://github.com/prismalens/prismalens/issues/755)) ([fc27a89](https://github.com/prismalens/prismalens/commit/fc27a895c45f09d4edb25aa8ff7afd5753437560))
* **harness:** record the model the agent reports, flag a substitution, and drop the read-only claim from the report chip ([#639](https://github.com/prismalens/prismalens/issues/639)) ([#727](https://github.com/prismalens/prismalens/issues/727)) ([06d319d](https://github.com/prismalens/prismalens/commit/06d319d596ce0d20e6b8d225571490021d23bce6))
* **harness:** supported agents on their own sign-in, no safety verdict, no placement ([#634](https://github.com/prismalens/prismalens/issues/634)) ([#707](https://github.com/prismalens/prismalens/issues/707)) ([cd00535](https://github.com/prismalens/prismalens/commit/cd00535b22633cf98c5d587fe0d25066ee831521))
* **install:** the whole lifecycle on every channel: pl upgrade, PATH, fallback, rollback, uninstall, and guards for two copies and downgrades ([#717](https://github.com/prismalens/prismalens/issues/717)) ([#721](https://github.com/prismalens/prismalens/issues/721)) ([46d360e](https://github.com/prismalens/prismalens/commit/46d360eb1837e41ed981f4a731cac4d4899f373a))
* message a running investigation, stop it from anywhere, run state in its own words ([#743](https://github.com/prismalens/prismalens/issues/743)) ([#744](https://github.com/prismalens/prismalens/issues/744)) ([ce41bca](https://github.com/prismalens/prismalens/commit/ce41bca457c8b063d4a9ff520d10d137a10e1d23))
* opt-in PostHog telemetry, asked once, off by default ([#666](https://github.com/prismalens/prismalens/issues/666)) ([5bbc739](https://github.com/prismalens/prismalens/commit/5bbc73967e35efa07190a65a55100d4fcfa109f2))
* post a completed report as a comment on a GitHub issue or PR ([#679](https://github.com/prismalens/prismalens/issues/679)) ([e48cb26](https://github.com/prismalens/prismalens/commit/e48cb261a147a603547067fac93e59ffdc8e6422))
* pull alerts on open from Alertmanager, catch up from Prometheus ([#680](https://github.com/prismalens/prismalens/issues/680)) ([b6e6a77](https://github.com/prismalens/prismalens/commit/b6e6a7792478d1608b4289ea7197c396a3ae1695))
* rebrand to the p-lens glint mark ([#745](https://github.com/prismalens/prismalens/issues/745)) ([#746](https://github.com/prismalens/prismalens/issues/746)) ([2e72095](https://github.com/prismalens/prismalens/commit/2e7209572ef3ff271ca29e255f6390fecedf3cc2))
* record the actual cause on close and cite it in similar incidents ([#667](https://github.com/prismalens/prismalens/issues/667)) ([f2c33a0](https://github.com/prismalens/prismalens/commit/f2c33a0bf5448cbd4d9e3499f8efb8e79f583654))
* screens reach one PrismaLens per workspace without breaking each other ([#763](https://github.com/prismalens/prismalens/issues/763)) ([#764](https://github.com/prismalens/prismalens/issues/764)) ([90e021b](https://github.com/prismalens/prismalens/commit/90e021b46ec09055e2341fe51c8dcd51e9d8f454))
* telemetry and host facts reach the run ([#678](https://github.com/prismalens/prismalens/issues/678)) ([8cb9712](https://github.com/prismalens/prismalens/commit/8cb9712c52ccb9aa0eaf0853acee7f15adbfa583))
* **telemetry:** EU project, day timestamps, run mode and build, daily presence, recently sent ([#602](https://github.com/prismalens/prismalens/issues/602)) ([#716](https://github.com/prismalens/prismalens/issues/716)) ([3a30a11](https://github.com/prismalens/prismalens/commit/3a30a1134f4ef27f4697805d6a025033a8c34bab))
* the incident band in the desktop title strip, and a follow-up that ends early puts its run back ([#752](https://github.com/prismalens/prismalens/issues/752)) ([#756](https://github.com/prismalens/prismalens/issues/756)) ([bd56d18](https://github.com/prismalens/prismalens/commit/bd56d186e551ca185ae1c3f82c0d0a68807a54e5))
* workspace lock, pl reset-password, cancel reaches the clone, safe resets ([#662](https://github.com/prismalens/prismalens/issues/662)) ([f6cc503](https://github.com/prismalens/prismalens/commit/f6cc50330f6780727dec0a3bc5793f8cd6ffe45e))


### Bug Fixes

* a flap refire reopens its resolved incident, and an env-supplied model is never reported as substituted ([#741](https://github.com/prismalens/prismalens/issues/741)) ([8769049](https://github.com/prismalens/prismalens/commit/87690499865914fbf6b165a8ce96c2326f84fa48))
* **alerts,engine:** two services in one grouped delivery stay two incidents; host facts stay inferred ([#633](https://github.com/prismalens/prismalens/issues/633)) ([#706](https://github.com/prismalens/prismalens/issues/706)) ([2283839](https://github.com/prismalens/prismalens/commit/22838392567fb1ef97d461982c060078a085dd77))
* **api:** an alert arriving mid-investigation is visible, not silently dropped ([#669](https://github.com/prismalens/prismalens/issues/669)) ([53bb654](https://github.com/prismalens/prismalens/commit/53bb65435daf5e920da4f0fe1cf07999f9243958))
* **ci:** retry a reset connection in the app-boot smoke script ([#772](https://github.com/prismalens/prismalens/issues/772)) ([4a7f8cc](https://github.com/prismalens/prismalens/commit/4a7f8ccd8297db47729c02d6befdeffcdb2b6b13))
* **cli:** the consent line no longer calls usage events anonymous ([#731](https://github.com/prismalens/prismalens/issues/731)) ([f4fc7e2](https://github.com/prismalens/prismalens/commit/f4fc7e2bdf6ef8917e936e60db968e26c41022ff))
* **desktop:** rebuild better-sqlite3 for Electron when no prebuilt exists ([533230c](https://github.com/prismalens/prismalens/commit/533230ce4917f2a004a2d70db7cdd58687402402))
* **engine:** access levels and an honest read-only guardrail, tested against a red-team corpus ([#778](https://github.com/prismalens/prismalens/issues/778)) ([ca53c86](https://github.com/prismalens/prismalens/commit/ca53c86b8a684e3a733a148da307ce9eee5102f2))
* **engine:** an EPIPE no longer hides why the harness died ([#670](https://github.com/prismalens/prismalens/issues/670)) ([9999722](https://github.com/prismalens/prismalens/commit/9999722674050b503491b09ec3d5c86227246756))
* **engine:** the deadline kills the harness's process group, and shutdown reaps it ([#693](https://github.com/prismalens/prismalens/issues/693)) ([843f349](https://github.com/prismalens/prismalens/commit/843f3491905060c5c23e661c529655b9e1103834))
* **engine:** the permission policy judges the real path, not the lexical one ([#685](https://github.com/prismalens/prismalens/issues/685)) ([ddaa8d0](https://github.com/prismalens/prismalens/commit/ddaa8d0f3aa662a044e555d6348cb168b50459d3))
* **frontend:** a list row stays lit only while the pointer or the keyboard cursor is on it ([#738](https://github.com/prismalens/prismalens/issues/738)) ([#739](https://github.com/prismalens/prismalens/issues/739)) ([59ebec9](https://github.com/prismalens/prismalens/commit/59ebec9f54084ba947bd10741b4209b11766b7c2))
* **frontend:** hide the report JSON that follows prose in the progress panel ([#660](https://github.com/prismalens/prismalens/issues/660)) ([d9c5223](https://github.com/prismalens/prismalens/commit/d9c522303a9e18580ce47b3d68a6c79e07e534a4))
* GitLab/Bitbucket token usernames, deepagents row runs dcode --acp, codex read-only mode ([#665](https://github.com/prismalens/prismalens/issues/665)) ([21e16ed](https://github.com/prismalens/prismalens/commit/21e16ed63b67655f85fbfe6efd821ca33e9aec31))
* harness behind a proxy, capped alert text, resolution before firing ([#664](https://github.com/prismalens/prismalens/issues/664)) ([2ddbe4c](https://github.com/prismalens/prismalens/commit/2ddbe4cd531393bf6bc809e9214bb66d374bbe7d))
* **integrations:** refuse an unusable installation token, interpolate a templated tokenUrl ([#668](https://github.com/prismalens/prismalens/issues/668)) ([06d1017](https://github.com/prismalens/prismalens/commit/06d10172fc2ae4250c56fd2732b42cc512cc66ba))
* **pair:** point other devices at Tailscale, not a LAN IP ([#774](https://github.com/prismalens/prismalens/issues/774)) ([e25dcef](https://github.com/prismalens/prismalens/commit/e25dcef1b08d55b65c4b3ddc0096777c746dc686))
* SQL keeps LF on every checkout, so Windows builds' migration checksums match the published ones ([#722](https://github.com/prismalens/prismalens/issues/722)) ([9d17e9f](https://github.com/prismalens/prismalens/commit/9d17e9f5ebfc536efeb39b7cd7a790825812ff24))
* the 0.5.1 walk's code defects — alert lifecycle, follow-ups, live updates, agent access, stop and reset ([#776](https://github.com/prismalens/prismalens/issues/776)) ([6929f0e](https://github.com/prismalens/prismalens/commit/6929f0e2bdb7787a1b932acd7962b8a1b9719a07))


### Code Refactoring

* remove the sandbox providers and every promise about them ([#682](https://github.com/prismalens/prismalens/issues/682)) ([e70f87e](https://github.com/prismalens/prismalens/commit/e70f87ec814f882b257ac1bdada841a604c21ebb))

## [0.5.0](https://github.com/prismalens/prismalens/compare/prismalens@0.5.0-rc.3...v0.5.0) (2026-09-19)


### ⚠ BREAKING CHANGES

* harden the 0.5.0 run (U12): refuse fetch, isolate harness config, reap snapshots, no install beacon ([#643](https://github.com/prismalens/prismalens/issues/643))
* trust floor, harness readiness probe and per-run repo snapshot (U6, U7, U8) ([#640](https://github.com/prismalens/prismalens/issues/640))
* one ACP run per investigation, detect-and-report harness, deferred modules and pre-release lineage removed ([#621](https://github.com/prismalens/prismalens/issues/621))

### Features

* **cli:** pl up prints the log path and the ready URL, harness stderr goes to the logger ([#625](https://github.com/prismalens/prismalens/issues/625)) ([d763f64](https://github.com/prismalens/prismalens/commit/d763f649c4f9640501d40c6e4fbeaa66336887fc))
* trust floor, harness readiness probe and per-run repo snapshot (U6, U7, U8) ([#640](https://github.com/prismalens/prismalens/issues/640)) ([f99406b](https://github.com/prismalens/prismalens/commit/f99406b467f63c761c73b23f47b562da3decbbd1))


### Bug Fixes

* **cli:** pl up runs the packaged app as production ([#652](https://github.com/prismalens/prismalens/issues/652)) ([7fad438](https://github.com/prismalens/prismalens/commit/7fad4386d3f2c120a3f2dba0e66cec6f77799343))
* harden the 0.5.0 run (U12): refuse fetch, isolate harness config, reap snapshots, no install beacon ([#643](https://github.com/prismalens/prismalens/issues/643)) ([54d9a8f](https://github.com/prismalens/prismalens/commit/54d9a8f328401f9bb67876039b1f3a5ce9252be4))
* stranger walk run e gaps G10 to G19: extractor, default model, doctor, stale queries, guardrail, reaping ([#651](https://github.com/prismalens/prismalens/issues/651)) ([65adef5](https://github.com/prismalens/prismalens/commit/65adef5cf7635ace3e695631cc7bd26c3f8b7930))


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

- 0049fa8: cli/config: normalize key casing and split the
  harness/reduce model knobs (#180, #148 items 8-11).

  - **Config key casing (item 8):** `telemetry` keys are now snake_case
    (`prometheus_url`, `alertmanager_url`, `api_url`) to match every other config key.
    No back-compat aliases (dev phase) — update your `prismalens.config.yaml`.
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
  - One canonical Ollama base URL, with `/v1` appended in exactly one place; the never-read `PRISMALENS_OLLAMA_BASE_URL` env var is gone.
  - Missing `listen.token` prints one actionable error instead of a stack trace.
  - Engine contract: `SynthesisModelConfig` gains a required `configured: boolean` (set by the host from the resolver outcome; the engine stays env-clean).

- 2c25539: Adds alert storm grouping to `pl listen`. Firing alerts arriving close together are now debounced (default `listen.grouping_window_ms` of 60000ms) into a single group using a coarse key ladder (Alertmanager's `groupKey`/`groupLabels` if present, else `alertname` + service label, else alert labels, else a fallback). One investigation is dispatched per group carrying the full multi-alert context. Alerts arriving while their group's investigation is already running attach to it (deduped by fingerprint or label hash) instead of triggering redundant runs. Group metadata is recorded as a `GroupRecord` with `formedBy: "window"`.
- 0d1b430: New `pl listen` command (Phase 1 R1, #58): a token-authed local HTTP receiver
  for Alertmanager webhooks. Each firing alert triggers a full investigation —
  config and repo resolved per payload — with the report written to the
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

- a336543: Harness failure containment. A mid-run harness abort
  (e.g. deepagents killing its whole turn on one tool exception) no longer kills a
  single-branch run: the branch is respawned once in a fresh session, and if that also
  aborts, the failure becomes the branch's terminal `error` event and the reduce step
  still synthesizes a partial report from the evidence already gathered. Setup failures
  before the first event (binary missing, init handshake) still propagate. The
  investigation prompt now pins file reads/searches to the repository working directory
  (deepagents' filesystem tools follow model-supplied absolute paths outside the
  workspace root), and `deepagents-acp` is invoked with an explicit `-w <repo>` since it
  ignores the ACP `session/new` cwd.
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
