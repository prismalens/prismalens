# spike: investigate (M1)

**Throwaway** spike that validates the M1 thin-loop design — *not* production code.
It proves a tool-calling loop **we own** can run one investigation end-to-end:

- **Our loop** (`src/loop.ts`) — no LangGraph, no `deepagents`, no harness. ~120 lines.
- **Swappable backend** (`src/backends/`) — Gemini (free tier) or Ollama (local), behind one `ModelBackend` seam.
- **One read-only shell tool** (`src/tools/shell-exec.ts`) — deny-by-default allowlist, executed via `execFile` (no shell).
- **Ordered-evidence report** (`src/report.ts`, `src/types.ts`) — ranked hypotheses + `verified`/`inferred` evidence, **no numeric confidence**.

In-process, no Redis/worker/API/DB — that's the point (proves the engine is embeddable for the local-installable goal).

## Run

```bash
# from repo root
pnpm install                      # picks up this workspace package
cp spikes/investigate/.env.example spikes/investigate/.env
# edit .env: paste your free Gemini key (https://aistudio.google.com) into GOOGLE_API_KEY
#   (never paste a key on a command line or in chat)

# edit allowlist.example.json (or point SPIKE_ALLOWLIST_FILE elsewhere) to the
# read-only CLIs you actually have, then:

pnpm --filter @prismalens/spike-investigate investigate "pods in ns prod are crashlooping since 14:00"

# local, no key (needs Ollama running with a tool-capable model):
pnpm --filter @prismalens/spike-investigate investigate --backend ollama --model qwen2.5 "checkout latency spiked"
```

Flags: `--backend gemini|ollama`, `--model <name>`, `--max-steps <n>`, `--allowlist <file>`.

## Safety

`shell_exec` is deny-by-default: a command runs only if its binary is in the allowlist
(and, if listed, its first arg is an allowed read-only subcommand). It runs via `execFile`
(no shell — pipes/redirects/substitution are impossible) and rejects mutating verbs and
shell metacharacters. The Gemini key is sent in a header (never the URL) and scrubbed from
error output.

## What to watch when it runs (the open question)

Whether the loop's **stop rule** behaves — it should keep gathering until the top hypothesis
has a `verified` supporting observation (and no `verified` contradiction) or the step budget
hits, then submit. If it stops too early / loops too long, that rule is the thing to tune.
