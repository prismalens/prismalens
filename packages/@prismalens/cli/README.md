# @prismalens/cli

The PrismaLens **investigation engine CLI** — the `prismalens` (alias `pl`) binary.

Per **ADR-0010**, the engine *is* a CLI: the desktop app and web API drive it
rather than embedding it. The CLI is a thin **Tier-1 supervisor** that rents a
**Tier-2 agent harness** (ADR-0008) to do the read-only legwork, then reduces the
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

The harness investigates **read-only**. Provider credentials are **BYO-key**
(ADR-0006) and come from the environment — never hard-bound in the CLI.

Every run is persisted to a durable workspace under `~/.prismalens/runs/<runId>/`
(`events.jsonl` + `report.json` + `session.json`), regardless of how it was
invoked.

---

## Install / build

This package lives in the pnpm + turbo monorepo and is consumed by the rest of the
platform via `workspace:*`. It is not published standalone (`"private": true`).

```bash
# from the repo root
pnpm install

# build the CLI and its workspace deps (@prismalens/contracts, @prismalens/engine)
pnpm build                      # turbo build (whole monorepo)
# or just this package + its deps:
pnpm --filter @prismalens/cli... build
```

The build emits `dist/`, exposing two bin entries (identical):

```
prismalens -> dist/bin/prismalens.js
pl         -> dist/bin/prismalens.js
```

For local development you can skip the build and run the TypeScript entry directly:

```bash
# from packages/@prismalens/cli
pnpm dev investigate --query "checkout latency spike"   # tsx bin/prismalens.ts ...
```

Run `prismalens doctor` before your first investigation to verify the harness
binary and an LLM credential are present.

---

## Commands

```
prismalens <command> [flags]      # alias: pl

  investigate   Run a read-only root-cause investigation of a firing alert.
  serve         Run the JSON-RPC 2.0 server over stdio (the LIVE channel for apps).
  doctor        Preflight-check the investigation environment.
  init          Scaffold a prismalens.config.yaml in the current directory.
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
| `--config <path>` | Path to a `prismalens.config.yaml` (skips the upward config search). |
| `--model <id>` | Override `agent.model` — a bare model id, e.g. `gpt-oss:120b`. |
| `--harness <name>` | Tier-2 backend: `deepagents` \| `claude-code` \| `codex`. Defaults to `agent.default`. |
| `--json` | Print the `InvestigationReport` as JSON to stdout (suppresses the human renderer; implies quiet). |
| `--output <file>` | Also write the `InvestigationReport` JSON to this file. |
| `--quiet` | Suppress progress + the human renderer (errors still go to stderr). |

**Exit codes:** `0` on a synthesized report; `1` on a hard input error, a
mid-stream failure, or a **no-evidence** run (a branch that gathered nothing and
errored emits no report — the CLI surfaces the transport failure rather than a
fabricated RCA).

A `FiringAlert` is `{ alertname, severity, labels, annotations, startsAt }`.

### `serve`

Runs the JSON-RPC 2.0 server over stdio — the live channel apps drive (see
[Driven by an app](#mode-2--driven-by-an-app-prismalens-serve)). No flags.

### `doctor`

Preflight checklist that gates a run. Prints pass/fail per check; exits non-zero
**iff a hard check fails**.

- **HARD — harness binary on PATH:** `deepagents` → `deepagents`,
  `claude-code` → `claude`, `codex` → `codex` (for the harness from config).
- **HARD — an LLM credential:** any of `OLLAMA_API_KEY` / `OPENAI_API_KEY` /
  `ANTHROPIC_API_KEY`, or, for `claude-code`, a signed-in
  `~/.claude/.credentials.json`.
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
harness?: string, model?: string, config?: string }`.

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
| `-32602` | Invalid params (includes `resolveInvestigation` input errors — e.g. no alert/query, unknown or unbuilt harness). |
| `-32603` | Internal error (mid-stream failure; `data` carries `{ runId }`). |
| `-32000` | No evidence — the harness branch failed and produced no report (`data` carries `{ runId }`). |

A malformed or failed request becomes a JSON-RPC error response — the server never
crashes on bad input.

---

## Configuration

`prismalens.config.yaml` (run `prismalens init` to scaffold one). Resolution order,
later overriding earlier:

1. built-in schema defaults,
2. global layer — `~/.prismalens/{prismalens,pl}.config.yaml` (a good home for
   BYO-key creds via `${VAR}` interpolation),
3. project layer — the explicit `--config` path, else the nearest config file found
   by walking **up** from the cwd,
4. CLI flag overrides (e.g. `--model`).

`${VAR}` patterns in string values are interpolated from the environment (an unset
var is an error).

```yaml
# Tier-2 harness backend the supervisor rents (ADR-0008).
agent:
  default: deepagents            # deepagents | claude-code | codex
  # model: openai:gpt-oss:120b   # provider-prefixed; omit to let the harness default

# Read-only telemetry + app endpoints the harness may query.
telemetry:
  prometheusUrl: http://localhost:9090
  alertmanagerUrl: http://localhost:9093
  apiUrl: http://localhost:3000

# Where runs, events, and reports are stored.
workspace:
  base_dir: ~/.prismalens

# Per-harness native passthrough (ADR-0017) — untyped, forwarded straight to the
# rented harness. For `deepagents` (driven over ACP), `shellAllowList` becomes the
# `-S csv` allow-listed shell commands.
harnesses:
  deepagents:
    native:
      shellAllowList: [gh, amtool, sentry-cli, pd, curl, jq, grep, cat]
```

Notes:
- `agent.model` in config is a **provider-prefixed** id (e.g. `openai:gpt-oss:120b`).
  The `--model` flag passes a **bare** id (e.g. `gpt-oss:120b`); for `deepagents` the
  CLI prefixes it with `openai:`.
- `telemetry.*` defaults to host-local URLs when unset.
- There is currently no `agent.timeout_ms`, `budget.*`, or `logging.*` config —
  an overall per-run wall-clock budget and a Tier-1 reduce token/retry budget are
  planned alongside the Phase B.1 Sandbox port's resource limits (ADR-0020), not
  wired yet.

### BYO-key environment (ADR-0006)

Credentials are read from the environment, never stored by the CLI.

- **Tier-1 reduce + the `deepagents` harness** use an OpenAI-compatible endpoint:
  - `OLLAMA_API_KEY` or `OPENAI_API_KEY` (the API key),
  - `OLLAMA_BASE_URL` or `OPENAI_BASE_URL` (base URL; defaults to
    `https://ollama.com/v1`).
- **The `claude-code` harness** uses your signed-in `~/.claude` session, or
  `ANTHROPIC_API_KEY`.

If no `OLLAMA_API_KEY` / `OPENAI_API_KEY` is set, the reduce (synthesis) call will
likely fail — `investigate` warns up front, and `doctor` checks for a credential.
