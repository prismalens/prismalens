# Harness transport gate

Decides, with evidence, whether prismalens drives a coding-agent harness through ACP or through the harness's own SDK. The answer lives in `results/`, not in an ADR paragraph, so it cannot be lost and re-argued.

## Run it

No API key and no harness login is used. The gate talks only to a loopback model endpoint, Ollama, and gives each harness an allowlisted environment with `HOME` inside a throwaway fixture. `env.ts` enforces both and its tests prove it.

```bash
# once: install Ollama, then sign in for the free cloud models
curl -fsSL https://ollama.com/install.sh | sh
ollama signin

pnpm --filter @prismalens/engine exec tsx scripts/harness-gate/run.ts \
  --driver claude-code.acp --isolate --runs 3
```

| Flag | Default | Meaning |
|---|---|---|
| `--driver` | required | `claude-code.acp`, `claude-code.native-sdk`, `opencode.acp`, `opencode.native-sdk` |
| `--isolate` | off | Apply the setting that keeps repo-supplied agent config inert (R4) |
| `--runs` | `3` | Repeats; the result records passes per row, e.g. `2/3` |
| `--model` | `gemma4:31b-cloud` | An Ollama model the account can use (free tier: `gemma4:31b-cloud`, `gpt-oss:120b-cloud`) |
| `--base-url` | `http://localhost:11434` | Must be loopback; anything else is refused |
| `--timeout` | `300` | Seconds per run |
| `--keep-fixtures` | off | Keep the fixtures and write `dump.json` (observation, turns, events) into each for debugging |

The result lands in `results/<driver>[.isolated].json` with the harness versions, the config that made it pass, and passes per requirement row.

## What a run does

Each run opens four sessions on fresh fixtures (`scenarios.ts`), through the driver's `GateSession` (`session.ts`): prompt, cancel, close, and every event stamped on arrival.

1. **Base.** `fixture.ts` creates a git repo holding a random nonce and traps: a Claude `.claude/settings.json` hook and `.mcp.json` server, an OpenCode project plugin and `opencode.json` MCP server. Each trap touches a marker file if the harness honours repo config. The prompt asks for four tool calls: read the nonce, call the injected `probe-mcp.ts` tool, write a file, run `touch`. Permission requests are answered with prismalens's policy (reads and the probe pass, the rest is refused). Then a follow-up prompt in the same session asks for the nonce again. Every model request goes through a loopback recorder (`recorder.ts`) that notes the model asked for. Rows R1-R5, R7, R12-R15, R18.
2. **Sub-agent.** The prompt asks the agent to delegate the nonce read to one sub-agent; its tool events must carry the spawning call's id. Row R10 (WANT).
3. **Interrupt.** A long text-only prompt is cancelled once it is streaming; the turn must settle within 10 s. Row R6.
4. **Errors.** The session asks for a model the endpoint does not serve; the failure must surface within 30 s. Row R16.

`verdict.ts` judges rows from disk and the event stream, never from the model's claims alone; its predicates have unit tests.

## Decision rule

- ACP passes every MUST row: use ACP.
- ACP fails a MUST row that the SDK passes: build a native driver and record the failing rows on the registry row (ADR-0003 item 8).
- Both fail a MUST row: the harness is not admitted.
- A WANT row never forces native. It becomes MUST when a milestone schedules the screen that needs it; then rerun every driver.
- Anything in `EXCLUDED` (`requirements.ts`) is never a reason to choose a transport.

`requirements.ts` lists every row with its tier. Rows marked `probed: false` show as `not probed` in results until a probe exists.

## Adding a harness

1. Add a driver per transport implementing `Driver` (`session.ts`): `open()` starts the harness keyless against `opts.baseUrl` with `harnessEnv(fx.home, ...)`, injects `fx.probe`, answers permissions with `allowed()`, and returns a `GateSession`. An ACP harness needs only `openAcp()` with its launch command (`acp.ts`); see `opencodeAcp` in `opencode.ts`.
2. If the harness reads repo config from its own files, add a trap for it in `fixture.ts` that touches `repo-hook-fired` or `repo-mcp-started`.
3. Register it in `registry.ts`, run it with and without `--isolate`, commit the result files.

## Findings so far

- Claude Code and OpenCode both honour repo-supplied config by default on both transports, so R4 fails without isolation. Claude: `settingSources: []` (SDK option, or `_meta.claudeCode.options.settingSources` on ACP `session/new`). OpenCode: `--pure` plus `OPENCODE_DISABLE_PROJECT_CONFIG=1` and `OPENCODE_DISABLE_CLAUDE_CODE=1`.
- With isolation on, all four drivers pass every probed MUST row 3/3 on `gemma4:31b-cloud` (R1-R7, R12-R16, R18). No MUST row separates ACP from the native SDK for Claude Code or OpenCode.
- R10 (sub-agent attribution, WANT) separates OpenCode's transports: over its SDK the child session's tool events arrive attributed; over ACP the sub-agent runs but only the parent `task` call is streamed, 0/3. Claude Code attributes sub-agent events on both transports (`_meta.claudeCode.parentToolUseId` on ACP).
- OpenCode ends the agent loop on the first refused tool call unless `experimental.continue_loop_on_deny` is `true`; without it no final answer, and so no report, arrives after a refused write.
