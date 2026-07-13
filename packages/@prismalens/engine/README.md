# @prismalens/engine

The PrismaLens **investigation engine library** — the two-tier engine behind the
`prismalens` CLI, published for programmatic embedding.

Most users want [`prismalens`](https://www.npmjs.com/package/prismalens) (the CLI),
not this package. Reach for `@prismalens/engine` only if you're embedding the
engine directly into your own Node process (a custom app, worker, or service) —
see [prismalens.io](https://prismalens.io) for the CLI and product docs.

## What it does

The engine is a thin **Tier-1 supervisor**: it rents a **Tier-2 coding-agent
harness** to do the investigative legwork (running shell commands
against your telemetry/logs/source), then reduces the harness's event stream
into an **ordered-evidence report** — hypotheses ranked most-to-least plausible,
each with supporting/contradicting evidence. There are deliberately **no
numeric confidence scores**.

- **Tier-1 (supervisor, this package):** seeds the investigation from a firing
  alert, drives the rented harness, and synthesizes the final report using an
  OpenAI-compatible or Anthropic model (via the Vercel AI SDK).
- **Tier-2 (rented harness):** `deepagents` (driven over ACP) or `claude-code`
  (driven over the Claude Agent SDK) — see the support matrix below.

By default the engine removes the harness's edit tools (`Edit`, `Write`,
`MultiEdit`, `NotebookEdit`). That is a **guardrail, not a security boundary**
(ADR-0017) — the shell is untouched, so writes remain possible via `Bash`.
Unsandboxed, the harness runs with whatever access the host process has. The only
real boundary is an enforced sandbox (ADR-0020), and even that is *confined
writes* — host and credentials read-only, workspace read-write, egress
allowlisted — not "read-only".

Provider credentials are **BYO-key** — read from the environment by the caller
and injected explicitly; the engine never reads `process.env` itself and never
hard-binds a provider.

## Install

```bash
npm install @prismalens/engine
```

Requires Node >= 22.

## Usage

```ts
import { deepAgentsHarness, investigateIncident } from "@prismalens/engine";
import type { InvestigationContext } from "@prismalens/contracts";

const context: InvestigationContext = {
  alerts: [
    {
      alertname: "CheckoutLatencyHigh",
      severity: "critical",
      labels: { service: "checkout" },
      annotations: { summary: "p99 latency > 2s for 10m" },
      startsAt: new Date().toISOString(),
    },
  ],
  telemetry: {
    prometheusUrl: "http://localhost:9090",
    alertmanagerUrl: "http://localhost:9093",
    apiUrl: "http://localhost:3000",
  },
};

const harness = deepAgentsHarness({
  cwd: "./my-service", // the harness's investigation target
  env: { OPENAI_API_KEY: process.env.OLLAMA_API_KEY ?? "" },
});

const { report } = await investigateIncident({
  context,
  harness,
  synth: {
    providerId: "ollama",
    model: "gpt-oss:120b",
    apiKey: process.env.OLLAMA_API_KEY,
    baseURL: "https://ollama.com/v1",
  },
});

console.log(report.summary);
console.log(report.hypotheses);
```

Swap `deepAgentsHarness` for `claudeCodeHarness({ cwd: "./my-service" })` to run
the Claude Code harness instead — see the support matrix below for its
credential requirements.

For a live progress feed instead of a single awaited result, use
`investigateIncidentStream(opts)` — an async generator that yields each
canonical event as it happens, ending with a terminal `report` event.

For persisting a run's lifecycle (create → append each event → finish/fail),
`conductRun(opts, { sink, store })` drives that ordering for you against your
own sink (e.g. a log line or a pub/sub channel) and store (e.g. a DB row).

## Report shape

`InvestigationReport` (from `@prismalens/contracts`): a `summary`, an optional
`rootCause` + `rootCauseCategory`, an ordered `hypotheses[]` (array position IS
the rank — most to least plausible, each with supporting/contradicting
`evidence[]`), a `ruledOut[]` list, `coverage` (what was/wasn't queried), and
`nextSteps[]`. No hypothesis or evidence item carries a numeric confidence
score — the ordering is the only ranking signal.

A run that gathers no evidence produces no report — the engine surfaces the
transport failure instead of fabricating an RCA.

## Harness support matrix

| Harness | Transport | Providers | Credential |
| --- | --- | --- | --- |
| `deepagents` | ACP (`deepagents-acp` binary on PATH) | OpenAI-protocol endpoints (Ollama, OpenAI, Groq, etc.) | `OLLAMA_API_KEY` or `OPENAI_API_KEY` (+ matching `*_BASE_URL`) |
| `claude-code` | Claude Agent SDK | Anthropic (Claude models) | A signed-in Claude Code CLI session, or `ANTHROPIC_API_KEY` |
| `codex` | — | — | Stubbed: constructing this harness throws — not implemented yet |

The Tier-1 reduce step (report synthesis) is a separate model call configured
via `synth` — any provider `resolveModel` supports (`anthropic`, `openai`,
`google`, `groq`, `ollama`, `custom`), independent of which harness you rent.

## BYO-key

All credentials are read from the environment by your calling code and passed
in explicitly (`env` on the harness config, `apiKey`/`baseURL` on `synth`). The
engine never stores or hard-binds a provider — bring your own key.

## License

Apache-2.0
