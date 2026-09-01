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

> **Status: v0.4.0, CLI-first launch.** The `prismalens` CLI is the released
> surface today. The self-hosted server in this monorepo (web UI, webhook
> alert intake, team features) is still in development and not part of the
> current release — these packages exist here but aren't shipped yet.

## Quick start

Requires **Node.js 24+**.

```bash
npm install -g prismalens
```

One package, one process, no external services. `pl up` runs the API and the
dashboard on a single port, creates a SQLite database in `~/.prismalens` on
first run, and applies its own migrations:

```bash
pl up                 # http://localhost:3001
pl up --port 8080     # or wherever you like
```

Open the URL and a four-step setup wizard walks you the rest of the way:

| Step | What it asks for | Skippable? |
|---|---|---|
| 1. Account | Owner email and password | No — it is the only thing that gates the app |
| 2. AI provider | A provider and model, plus an API key if that provider needs one. The key is encrypted (AES-256-GCM) into this instance's database — never written to a file. A signed-in Claude Code session on the machine is offered here as a keyless alternative | Yes |
| 3. Code location | An absolute path to a git checkout on this machine, mapped to a service. This is the directory investigations actually read | Yes |
| 4. First incident | A hand-off into authoring your first incident, or connecting a monitoring tool | Yes |

Each step's "done" is derived on the server from durable state — a user row, a stored
credential, a service with a checkout path, an incident row — so a reload, a
sign-in, or coming back tomorrow lands you on the first thing that is genuinely
still missing.

There is no Docker, no Redis and no separate frontend server: the tarball
carries the built dashboard and the API serves it from the same origin. Use
`--workspace <dir>` to put the database and secrets somewhere other than
`~/.prismalens`.

### Try it without an alert source

A fresh install has nothing pointed at it, so no incidents arrive on their own.
You do not need an Alertmanager to see the product work — author an incident by
hand:

1. **Settings → AI Provider**: set a provider and key. Investigations are
   disabled until you do, and the buttons say so.
2. **Incidents → Create Incident**: a title is the only required field. Pick a
   **Service** if you have one — that is what decides which code the
   investigation reads.
3. You land on the new incident (`INC-1`, **Alerts (0)**).
4. **Investigation → Start Investigation** runs the real investigation path on
   it, then shows the report.

That is the same `incidents.create` and `incidents.investigate` path the
correlation engine uses, so nothing about the run is a mock.

### Or just the CLI

The same binary is a standalone investigator that needs nothing running:

```bash
npx prismalens doctor
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

### Upgrading

```bash
npm install -g prismalens@latest
```

PrismaLens keeps data and run artifacts under `~/.prismalens`. Upgrade instructions and database migration details are documented at **[docs.prismalens.io](https://docs.prismalens.io)**.

## How it works

- **Two-tier engine.** A thin, deterministic PrismaLens supervisor (Tier-1)
  seeds an investigation from a firing alert and rents an agent harness
  (Tier-2) to do the investigative legwork, then reduces its event stream into the
  final report.
- **Bring your own harness.** By default, `claude-code` is used (driven over the
  Claude Agent SDK). `deepagents` (driven over ACP) is available as a long-tail
  harness — switch to it with `--harness deepagents` or `agent.default: deepagents`
  in `prismalens.config.yaml`. `codex` is stubbed. In the app, Settings → AI
  Provider → Investigation agent picks the harness and shows which credential
  each one has on this machine.
- **Bring your own model key.** Tier-1 and the `deepagents` harness talk to
  any OpenAI-compatible provider (Ollama, OpenAI, Groq, ...); `claude-code`
  uses your signed-in Claude Code session or an Anthropic key. Keys resolve
  env (`PROVIDER_API_KEY`) → `_FILE` (`PROVIDER_API_KEY_FILE`) → stored, where
  stored is opt-in local storage via `pl auth login` (`auth.json` in the app
  data dir, mode `0600`). With no Tier-1 key at all, investigations still run and
  the report is the harness's own output, passed through unsynthesized — a
  supported outcome, labelled as such in the app.
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
| `packages/api` | NestJS API server — shipped inside the `prismalens` tarball, booted by `pl up`. |
| `packages/frontend` | TanStack Start dashboard — built to static assets and served by the API on the same origin. |
| `packages/worker` | The per-run investigation child the API's dispatch loop forks. |

Only `packages/cli` is published, under the name `prismalens`. Everything else
is `private: true` and travels INSIDE that one tarball as bundled dependencies.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, testing workflows, and contribution guidelines. To work on the CLI specifically, see [`packages/cli/README.md`](packages/cli/README.md).

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

