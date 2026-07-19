# prismalens

The PrismaLens **investigation engine CLI** — the `prismalens` (alias `pl`) binary,
published on npm as the unscoped [`prismalens`](https://www.npmjs.com/package/prismalens) package.

Per **ADR-0010**, the engine *is* a CLI: the desktop app and web API drive it
rather than embedding it. The CLI is a thin **Tier-1 supervisor** that rents a
**Tier-2 agent harness** (ADR-0008) to do the investigative legwork, then reduces the
harness's canonical event stream into an **ordered-evidence report** (ADR-0002 —
hypotheses ranked most-to-least plausible, with supporting/contradicting
evidence; no numeric confidence scores).

- **Tier-1 (supervisor):** seeds the investigation from a firing alert, drives the
  rented harness live, and synthesizes the final report (the "reduce" step) using
  an OpenAI-compatible model.
- **Tier-2 (rented harness):** one of
  - `deepagents` — driven over **ACP**,
  - `claude-code` — driven over the **Claude Agent SDK**,
  - `codex` — **stubbed** (not implemented; selecting it throws).

## How the harness is contained

By default prismalens removes the harness's edit tools (`Edit`, `Write`,
`MultiEdit`, `NotebookEdit`). That is a **guardrail, not a security boundary**
(ADR-0017): the shell is untouched, so writes remain possible via `Bash`. It is
there to stop a *helpful* agent from editing the repo it was asked to investigate
— it will not stop a determined one.

**Without a sandbox, the harness runs as you** — your machine, your credentials,
your shell — exactly as if you had invoked the agent CLI yourself. prismalens
makes no safety claim in this mode, and none of the above should be read as one.

The **only** real boundary is an enforced sandbox (`--sandbox srt` or `e2b`,
ADR-0020): an OS-level box in which your host and credentials are read-only, the
harness gets a read-write **workspace**, and network egress is **allowlisted**.
Note that this is *confined writes*, not "read-only" — an investigation has to be
able to clone a repo and download artifacts. `--sandbox auto` is not yet an
enforced default; it can degrade to an unenforced floor.

Provider credentials are **BYO-key** (ADR-0006), resolved from the environment or
the local auth store — never hard-bound in the CLI.

Every run is persisted to a durable workspace under `~/.prismalens/runs/<runId>/`
(`events.jsonl` + `report.json` + `session.json`), regardless of how it was
invoked.

---

## Install

Requires Node.js >= 22.

```bash
# one-off, nothing installed globally
npx prismalens doctor

# or install the `prismalens` / `pl` bins globally
npm install -g prismalens
```

## Build from source

This package lives in the pnpm + turbo monorepo and is consumed by the rest of the
platform via `workspace:*`.

```bash
# from the repo root
pnpm install

# build the CLI and its workspace deps (@prismalens/contracts, @prismalens/engine)
pnpm build                      # turbo build (whole monorepo)
# or just this package + its deps:
pnpm --filter prismalens... build
```

The build emits `dist/`, exposing two bin entries (identical):

```
prismalens -> dist/bin/prismalens.js
pl         -> dist/bin/prismalens.js
```

For local development you can skip the build and run the TypeScript entry directly:

```bash
# from packages/cli
pnpm dev investigate --query "checkout latency spike"   # tsx bin/prismalens.ts ...
```

Run `prismalens doctor` before your first investigation to verify the harness
binary and an LLM credential are present.

---

## Commands

```
prismalens <command> [flags]      # alias: pl

  investigate   Run a read-only root-cause investigation of a firing alert.
  listen        Start a token-authed local HTTP listener for Alertmanager webhooks.
  serve         Run the JSON-RPC 2.0 server over stdio (the LIVE channel for apps).
  doctor        Preflight-check the investigation environment.
  init          Scaffold a prismalens.config.yaml in the current directory.
  auth          Manage stored BYO-key credentials for providers.
```

### `investigate`

Seeds an investigation from a firing alert, rents a Tier-2 harness, streams the
supervisor live (each canonical event is appended to the run workspace and printed
as a one-line timeline entry), and renders the ordered-evidence report.

The seed alert comes from **one of**:
- a **`FiringAlert` JSON piped on stdin** (also accepts a webhook/Alertmanager-shaped
  payload — `alertname`/`severity` are pulled from top-level fields, falling back to
  `labels`), or
- `--query` — a one-line description that is synthesized into a minimal alert.

| Flag | Description |
| --- | --- |
| `--repo <dir>` | Path to the repository the harness investigates (its cwd). Defaults to the current directory. |
| `--query, -q <text>` | Synthesize an alert from this one-line description (alternative to piping a `FiringAlert` JSON on stdin). |
| `--config <path>` | Path to a `prismalens.config.yaml` (skips the upward config search; fails closed for missing, unreadable, or invalid paths). |
| `--model <id>` | Override `agent.model` — a bare model id, e.g. `gpt-oss:120b`. |
| `--max-turns <n>` | Per-run turn ceiling for the default harness. |
| `--harness <name>` | Tier-2 backend: `deepagents` \| `claude-code` \| `codex`. Defaults to `agent.default`. |
| `--json` | Print the `InvestigationReport` as JSON to stdout (suppresses the human renderer; implies quiet). |
| `--output <file>` | Also write the `InvestigationReport` JSON to this file. |
| `--quiet` | Suppress progress + the human renderer (errors still go to stderr). |

**Exit codes:** `0` on a synthesized report; `1` on a hard input error, a
mid-stream failure, or a **no-evidence** run (a branch that gathered nothing and
errored emits no report — the CLI surfaces the transport failure rather than a
fabricated RCA).

A `FiringAlert` is `{ alertname, severity, labels, annotations, startsAt }`.

### `listen`

Start a token-authed local HTTP listener for Alertmanager webhooks; each firing alert triggers an investigation (Phase 1 R1).

```bash
PRISMALENS_LISTEN_TOKEN=xyz pl listen --config my-stack.yaml
```

### `serve`

Runs the JSON-RPC 2.0 server over stdio — the live channel apps drive (see
[Driven by an app](#mode-2--driven-by-an-app-prismalens-serve)). No flags.

### `doctor`

Preflight checklist that gates a run. Prints pass/fail per check; exits non-zero
**iff a hard check fails**.

- **HARD — harness binary on PATH:** `deepagents` → `deepagents-acp`,
  `claude-code` → `claude`, `codex` → `codex` (for the harness from config).
- **HARD — an LLM credential:** any of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
  `GOOGLE_API_KEY` / `OLLAMA_API_KEY` / `GROQ_API_KEY` / `CUSTOM_LLM_API_KEY`,
  a credential stored via `pl auth login` (`auth.json`), or, for `claude-code`,
  a signed-in `~/.claude/.credentials.json`. Doctor reports which layer supplied
  the credential (`source: env | file | stored | none`). (Performs a live
  provider model ping by default, while `--no-ping` skips it.)
- **SOFT — workspace writable:** `workspace.base_dir` can be created/written.

### `init`

Scaffolds a commented `prismalens.config.yaml` in the current directory, sourced
from the schema defaults so it never drifts from what the engine uses.
Non-interactive: if the file already exists it is left untouched.

---

## Usage modes

### Mode 1 — standalone

Run an investigation straight from the terminal. Inputs are resolved from the cwd
(or `--repo`), stdin/`--query`, and the merged config; the report is rendered to
the terminal and written to `~/.prismalens/runs/<runId>/`.

```bash
# Synthesized alert from a one-liner, deepagents harness, investigating ./my-service
prismalens investigate \
  --repo ./my-service \
  --query "p99 checkout latency tripled after 14:00 UTC" \
  --harness deepagents

# Pipe a real FiringAlert (or webhook/Alertmanager-shaped) payload on stdin
cat alert.json | prismalens investigate --repo ./my-service

# Machine-readable report (JSON to stdout) + a copy on disk, no progress chatter
prismalens investigate -q "OOMKilled in payments pod" --json --output report.json

# Pull the currently-firing alert from Alertmanager and investigate it
curl -s http://localhost:9093/api/v2/alerts?active=true \
  | jq '.[0]' \
  | prismalens investigate --repo ./payments --harness claude-code
```

Durable record for every run:

```
~/.prismalens/
  sessions.json                  # run index (runId -> SessionRecord)
  runs/<runId>/session.json      # per-run metadata mirror
  runs/<runId>/events.jsonl      # canonical event stream (one JSON per line)
  runs/<runId>/report.json       # the synthesized InvestigationReport
```

### Mode 2 — driven by an app (`prismalens serve`)

This is the **live channel** for the desktop app and web API — it replaces the old
`pl` file-watching reporter. The engine streams via `investigateIncidentStream`
(an async generator); `serve` forwards each canonical event as a notification.
Validated live against the sreforge `booklogr` incident with **both** harnesses
(`deepagents` over ACP, `claude-code` over the Agent SDK). The
`~/.prismalens/runs/<runId>/` workspace remains the durable record.

**Protocol:** JSON-RPC 2.0 over **stdio**, **newline-delimited** (one JSON value
per line in both directions — requests on stdin; responses + notifications on
stdout).

**`initialize`**

```jsonc
--> {"jsonrpc":"2.0","id":1,"method":"initialize"}
<-- {"jsonrpc":"2.0","id":1,"result":{
      "protocolVersion": 1,
      "serverInfo": { "name": "prismalens", "version": "0.0.1" }
    }}
```

**`investigate`** — `params`: `{ alert?: FiringAlert, query?: string, repo?: string,
harness?: string, model?: string, config?: string, service?: string, mode?: string,
dangerouslySkipPermissions?: boolean, sandbox?: string, maxTurns?: number }`.

CLI-parity params (each falls back to config when absent):

- `sandbox` — the isolation boundary (ADR-0020), the CLI's `--sandbox`: one of
  `auto` | `process` | `srt` | `e2b`. Absent ⇒ `agent.sandbox` from config. A
  supplied value that is not a known mode (or a mode the resolved harness cannot
  honour, e.g. `srt` on a non-ACP harness) is a `-32602` error — never a silent
  fall-back to the cooperative floor.
- `maxTurns` — per-run turn ceiling, the CLI's `--max-turns`: a positive integer.
  A supplied zero, negative, fractional, or non-numeric value is a `-32602` error —
  never a silently-removed cap.

Streams a **notification per canonical event** (including the terminal `report`
event), then **resolves the request** with `{ runId, report }`:

```jsonc
--> {"jsonrpc":"2.0","id":2,"method":"investigate",
     "params":{"query":"checkout latency spike","repo":"./my-service","harness":"deepagents"}}

// zero or more notifications, in order, as the supervisor streams:
<-- {"jsonrpc":"2.0","method":"investigate/event",
     "params":{"runId":"<uuid>","event":{ /* CanonicalEvent */ }}}
// ... agent_step, tool_result, branch_done, (error), then the terminal report event ...

// finally, the request resolves:
<-- {"jsonrpc":"2.0","id":2,"result":{"runId":"<uuid>","report":{ /* InvestigationReport */ }}}
```

`CanonicalEvent.kind` is one of `agent_step` | `tool_result` | `branch_done` |
`error` | `report`. Requests are fire-and-forget on the wire: multiple may run
concurrently and interleave their notifications — each notification carries its
`runId` so a driver can demultiplex.

**Error codes:**

| Code | Meaning |
| --- | --- |
| `-32700` | Parse error (invalid JSON on a line). |
| `-32600` | Invalid request (not a well-formed JSON-RPC 2.0 request). |
| `-32601` | Method not found. |
| `-32602` | Invalid params (includes an invalid `sandbox` mode or `maxTurns` value, and `resolveInvestigation` input errors — e.g. no alert/query, unknown or unbuilt harness). |
| `-32603` | Internal error (mid-stream failure; `data` carries `{ runId }`). |
| `-32000` | No evidence — the harness branch failed and produced no report (`data` carries `{ runId }`). |

A malformed or failed request becomes a JSON-RPC error response — the server never
crashes on bad input.

---

## Configuration

`prismalens.config.yaml` (run `prismalens init` to scaffold one). Resolution order,
later overriding earlier:

1. built-in schema defaults,
2. user layer — `config.yaml` in the OS config dir (Linux/WSL:
   `~/.config/prismalens/config.yaml`; macOS/Windows use the platform config dir),
   a good home for BYO-key creds via `${VAR}` interpolation,
3. project layer — the explicit `--config` path, else the nearest config file found
   by walking **up** from the cwd,
4. CLI flag overrides (e.g. `--model`).

`${VAR}` patterns in string values are interpolated from the environment (an unset
var is an error).

```yaml
# Tier-2 harness backend the supervisor rents (ADR-0008).
agent:
  default: deepagents            # deepagents | claude-code | codex
  # model: gpt-oss:120b          # bare id — the harness applies its own provider
                                 # prefix; omit to let the harness default
  sandbox: auto                  # auto | process | srt — isolation boundary (ADR-0020).
                                 # auto (default): srt (enforced OS boundary) WHEN its
                                 # egress bridge is healthy (a self-check catches WSL
                                 # mirrored-networking blackouts), else the cooperative
                                 # process floor — the degrade is logged, never silent.

# Read-only telemetry + app endpoints the harness may query.
telemetry:
  prometheus_url: http://localhost:9090
  alertmanager_url: http://localhost:9093
  api_url: http://localhost:3000

# Where runs, events, and reports are stored.
workspace:
  base_dir: ~/.prismalens

# Per-harness native passthrough (ADR-0017) — untyped, forwarded straight to the
# rented harness. For `deepagents` (the npm `deepagents-acp` binary, driven over
# ACP), `args` is appended verbatim to the CLI invocation. The binary has no
# shell-allowlist or sandbox flags — so the harness is unsandboxed (runs as you)
# until the Sandbox port's enforced providers land (ADR-0020/B.1).
harnesses:
  deepagents:
    native:
      args: [--memory, ./AGENTS.md]
```

Notes:
- `agent.model` sets the **Tier-2 harness** model only (a bare id, e.g. `gpt-oss:120b`;
  each harness applies its own provider prefix). `--model` overrides it.
- `synth.model` sets the **Tier-1 reduce** (report-synthesis) model — a separate call
  to a separate provider (ADR-0013/0016). `agent.model` never feeds it, so a harness on
  one provider (e.g. `claude-code`) can't misroute the reduce call to another (ollama).
- `telemetry.*` keys are snake_case (`prometheus_url`, `alertmanager_url`, `api_url`)
  and default to host-local URLs when unset.
- There is currently no `agent.timeout_ms`, `budget.*`, or `logging.*` config —
  an overall per-run wall-clock budget and a Tier-1 reduce token/retry budget are
  planned alongside the Phase B.1 Sandbox port's resource limits (ADR-0020), not
  wired yet.

### BYO-key environment (ADR-0006)

Credentials are BYO-key and never hard-bound in the CLI. They can be read from the environment or stored locally via the `auth` command.

The resolution precedence for any credential is: **env** (`PROVIDER_API_KEY`) → **_FILE** (`PROVIDER_API_KEY_FILE`) → **stored** (from `auth.json`) → **none**.

**Auth commands:**
- `pl auth login <provider> [--api-key <key>]` — save a credential (prompts securely if `--api-key` is omitted).
- `pl auth list` — view saved providers.
- `pl auth logout <provider>` — remove a saved credential.

Stored credentials live in `auth.json` inside the app-data dir (`~/.prismalens` by default, honors `PRISMALENS_USER_FOLDER`), enforced to mode `0600`.

- **Tier-1 reduce + the `deepagents` harness** use an OpenAI-compatible endpoint:
  - `OLLAMA_API_KEY` or `OPENAI_API_KEY` (the API key),
  - `OLLAMA_BASE_URL` or `OPENAI_BASE_URL` (base URL; defaults to
    `https://ollama.com/v1`).
- **The `claude-code` harness** uses your signed-in `~/.claude` session, or
  `ANTHROPIC_API_KEY`.

If no matching credential is found across the resolution chain, the reduce (synthesis) call will
likely fail — `investigate` warns up front, and `doctor` checks for a credential.
