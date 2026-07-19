<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png">
    <img alt="PrismaLens — AI root-cause investigation, in your terminal" src=".github/assets/banner-light.png" width="830">
  </picture>
</p>

PrismaLens investigates a firing alert the way an on-call engineer would: it
reads the repo, queries your read-only telemetry, and comes back with an
**ordered-evidence report** — hypotheses ranked most to least plausible, each
backed by evidence it actually gathered, with no fake numeric confidence
scores. It's open source (Apache-2.0), local-first, and BYO-key — no
PrismaLens account, no subscription.

> **Status: v0.0.x, CLI-first launch.** The `prismalens` CLI is the released
> surface today. The self-hosted server in this monorepo (web UI, webhook
> alert intake, team features) is still in development and not part of the
> current release — these packages exist here but aren't shipped yet.

## Quick start

Requires **Node.js 22+**.

```bash
# try it without installing anything
npx prismalens doctor

# or install it globally
npm install -g prismalens
```

`doctor` checks that a harness binary and a model credential are in place,
then investigate:

```bash
pl investigate --repo . --query "checkout latency spike after 14:00 UTC"
```

Pipe in a real alert instead of describing one:

```bash
cat alert.json | pl investigate --repo ./my-service
```

Both `prismalens` and the shorter `pl` alias point at the same binary. Full
setup (providers, harnesses, configuration, commands) lives at
**[docs.prismalens.io](https://docs.prismalens.io)**.

## How it works

- **Two-tier engine.** A thin, deterministic PrismaLens supervisor (Tier-1)
  seeds an investigation from a firing alert and rents an agent harness
  (Tier-2) to do the investigative legwork, then reduces its event stream into the
  final report.
- **Bring your own harness.** By default, `claude-code` is used (driven over the
  Claude Agent SDK). `deepagents` (driven over ACP) is available as a long-tail
  harness — switch to it with `--harness deepagents` or `agent.default: deepagents`
  in `prismalens.config.yaml`. `codex` is stubbed.
- **Bring your own model key.** Tier-1 and the `deepagents` harness talk to
  any OpenAI-compatible provider (Ollama, OpenAI, Groq, ...); `claude-code`
  uses your signed-in Claude Code session or an Anthropic key. Keys resolve
  env (`PROVIDER_API_KEY`) → `_FILE` (`PROVIDER_API_KEY_FILE`) → stored, where
  stored is opt-in local storage via `pl auth login` (`auth.json` in the app
  data dir, mode `0600`).
- **Tool guardrails, not read-only.** Edit tools are removed by default as a
  guardrail — `Bash` can still write. The real boundary is an enforced
  `--sandbox`, which confines writes and allowlists egress.
- **Ordered evidence, not scores.** Reports rank hypotheses by plausibility
  with supporting/contradicting evidence per hypothesis — never a numeric
  confidence number.
- **Every run is durable.** Events, session metadata, and the final report
  are written to `~/.prismalens/runs/<runId>/` regardless of how the run was
  invoked (terminal, or driven live over JSON-RPC by an app).

## Monorepo layout

| Package | What it is |
| --- | --- |
| `packages/cli` | The `prismalens`/`pl` binary — the released engine CLI. |
| `packages/@prismalens/engine` | The two-tier investigation engine (supervisor, harness adapters, conductor) the CLI drives. |
| `packages/@prismalens/contracts` | Shared Zod schemas and canonical event/report types. |
| `packages/@prismalens/config` | Shared config and environment-variable resolution. |
| `packages/@prismalens/auth` | Auth configuration and client (Better Auth), for the in-development server. |
| `packages/@prismalens/database` | Prisma client and database adapter, for the in-development server. |
| `packages/@prismalens/integrations` | Integration templates, OAuth2 flows, credential encryption, for the in-development server. |
| `packages/@prismalens/logger` | Wide-events logging with tail sampling, shared across packages. |
| `packages/@prismalens/design-tokens` | Shared brand/design tokens for the (in-development) web UI. |
| `packages/api` | NestJS API server — in development, not part of the current release. |
| `packages/frontend` | TanStack Start dashboard — in development, not part of the current release. |
| `packages/worker` | BullMQ queue worker for agent execution — in development, not part of the current release. |

## Development

```bash
pnpm install

pnpm build           # turbo build across the workspace
pnpm test            # turbo test across the workspace
pnpm typecheck       # turbo typecheck across the workspace
pnpm format-and-lint # biome check
```

To work on the CLI specifically, see
[`packages/cli/README.md`](packages/cli/README.md).

## Links

- Site: [prismalens.io](https://prismalens.io)
- Docs: [docs.prismalens.io](https://docs.prismalens.io)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [VERSIONING.md](VERSIONING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)

## License

[Apache License 2.0](LICENSE) — see also [NOTICE](NOTICE). The hosted cloud /
enterprise edition is a separate, proprietary product.
