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
| `--keep-fixtures` | off | Keep the fixture and write `observation.json` into it for debugging |

The result lands in `results/<driver>[.isolated].json` with the harness versions, the config that made it pass, and passes per requirement row.

## What a run does

1. `fixture.ts` creates a git repo holding a random nonce and traps: a Claude `.claude/settings.json` hook and `.mcp.json` server, an OpenCode project plugin and `opencode.json` MCP server. Each trap touches a marker file if the harness honours repo config.
2. The driver starts the harness through one transport, injects the `probe-mcp.ts` server, and sends the same prompt: read the nonce, call the MCP tool, write a file, run `touch`, answer with the nonce and token.
3. The driver answers every permission request with prismalens's policy: allow reads and the probe tool, refuse writes and shell.
4. `verdict.ts` judges rows from what happened on disk and in the stream, never from the model's claims alone.

## Decision rule

- ACP passes every MUST row: use ACP.
- ACP fails a MUST row that the SDK passes: build a native driver and record the failing rows on the registry row (ADR-0003 item 8).
- Both fail a MUST row: the harness is not admitted.
- A WANT row never forces native. It becomes MUST when a milestone schedules the screen that needs it; then rerun every driver.
- Anything in `EXCLUDED` (`requirements.ts`) is never a reason to choose a transport.

`requirements.ts` lists every row with its tier. Rows marked `probed: false` show as `not probed` in results until a probe exists.

## Adding a harness

1. Add a driver per transport implementing `Driver` (`drivers.ts`): start the harness keyless against `opts.baseUrl`, pass `harnessEnv(fx.home, ...)`, inject `fx.probe`, answer permissions with the refuse-writes policy, return `observe(fx, ...)`.
2. If the harness reads repo config from its own files, add a trap for it in `fixture.ts` that touches `repo-hook-fired` or `repo-mcp-started`.
3. Register it in `registry.ts`, run it with and without `--isolate`, commit the result files.

## Findings so far

- Claude Code and OpenCode both honour repo-supplied config by default on both transports, so R4 fails without isolation. Claude: `settingSources: []` (SDK option, or `_meta.claudeCode.options.settingSources` on ACP `session/new`). OpenCode: `--pure` plus `OPENCODE_DISABLE_PROJECT_CONFIG=1` and `OPENCODE_DISABLE_CLAUDE_CODE=1`.
- OpenCode ends the agent loop on the first refused tool call unless `experimental.continue_loop_on_deny` is `true`; without it no final answer, and so no report, arrives after a refused write.
