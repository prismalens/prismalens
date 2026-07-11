# @prismalens/engine

## 0.1.0

### Minor Changes

- 3b99bdc: `claude-code` is now the default harness, replacing `deepagents` (ADR-0021's hero-harness lane). Harness runner construction moves off a hardcoded switch onto an engine-side `HARNESS_RUNNERS` map — the single source of truth for how each harness's runner is built — while the data-only registry keeps describing what each harness can do. The three harness errors (unknown id, not implemented, no runner wired) are unchanged, and `deepagents` stays selectable via config or `--harness`.
- 3b99bdc: The Claude Code (Agent-SDK) harness now spawns through the engine's `Sandbox` port, so every Claude Code investigation runs inside at least the process-isolation floor — the same caller-owned lifecycle the ACP path already uses (ADR-0020, "floor always on"). The transport honors `sandbox` and resource `limits` config (the old guard that rejected sandboxing for `agent-sdk` is gone), and `RunFidelity.sandbox` is now reported for Claude Code exactly as it is for ACP.
- a79f5ef: Credential resolution and CLI safety fixes (#142–#147):

  - Unified credential resolution for all LLM providers per ADR-0024: precedence env → `_FILE` → none; the config file carries provider/model selection only (`synth.provider`, `synth.model`, `synth.base_url`), never secrets. `_FILE` values get exactly one trailing newline trimmed; a missing `_FILE` target is a hard error. Tier-1 is no longer hardcoded to ollama — `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, and `GROQ_API_KEY` now work, auto-selected in registry order when `synth.provider` is unset.
  - `pl doctor` stops guessing: it reports the resolved provider and source layer, and proves the credential is callable via a live ping (skip with `--no-ping`); broken or unparseable config is now a red failure naming the file, never green-with-warn.
  - Explicit `--config <path>` fails closed on missing, unreadable, or invalid files before any dispatch — a stated config can no longer be silently ignored while a token-burning run proceeds on defaults.
  - New `agent.max_turns` config key and `--max-turns` flag bound `pl investigate` runs the same way `listen.caps.max_turns` bounds listen-dispatched ones.
  - One canonical Ollama base URL per placement, with `/v1` appended in exactly one place; the never-read `PRISMALENS_OLLAMA_BASE_URL` env var is gone.
  - Missing `listen.token` prints one actionable error instead of a stack trace.
  - Engine contract: `SynthesisModelConfig` gains a required `configured: boolean` (set by the host from the resolver outcome; the engine stays env-clean).

### Patch Changes

- f9dfc13: Fix subscription-only `pl listen`/`pl investigate` runs producing no report (#131, #132). The Tier-1 reduce/synthesis step is the only direct model call in an investigation; with no provider key it fell back to the keyless cloud endpoint, 401'd, and the run was marked errored with nothing persisted — even though the harness's diagnosis was already gathered. Now: when no Tier-1 provider is configured the supervisor skips the model call entirely and persists the harness's submitted branch conclusion(s) as a report clearly marked raw/un-synthesized (#131); and when the reduce model call throws for any reason, the same raw report is salvaged with the synthesis error surfaced in it rather than erroring the run (#132). `pl listen` prints one startup line noting reports will be raw pass-through until a provider is configured (a supported subscription-only path, not a failure). No schema change; raw reports flow through the existing done/finish path and render in `pl report` and Slack.
- Updated dependencies [a79f5ef]
- Updated dependencies [f9dfc13]
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

## 0.0.1

### Patch Changes

- 0621354: First public release. The `prismalens` CLI (bins `prismalens` + `pl`) and its
  library closure — `@prismalens/engine`, `@prismalens/contracts`,
  `@prismalens/config` — publish to npm as 0.0.1 under Apache-2.0.
- Updated dependencies [0621354]
  - @prismalens/contracts@0.0.1
  - @prismalens/config@0.0.1
