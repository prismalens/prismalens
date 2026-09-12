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

Open the URL and setup asks for one thing: the owner account. Everything else is
configured after sign-in. A coding agent must be installed on the machine for
investigations to run; `pl doctor` lists the ones PrismaLens knows, which are on
PATH, and how to install one (OpenCode, `curl -fsSL https://opencode.ai/install | bash`,
is the verified default). PrismaLens never bundles, installs or authenticates a
harness. Set `PRISMALENS_HARNESS=<id>` to pin one.

There is no Docker, no Redis and no separate frontend server: the tarball
carries the built dashboard and the API serves it from the same origin. Use
`--workspace <dir>` to put the database and secrets somewhere other than
`~/.prismalens`.

### Try it without an alert source

A fresh install has nothing pointed at it, so no incidents arrive on their own.
You do not need an Alertmanager to see the product work — author an incident by
hand:

1. **Install a coding agent** (OpenCode by default) and run `pl doctor`. The
   Investigate button says why when nothing is on PATH.
2. **Incidents → Create Incident**: a title is the only required field. Pick a
   **Service** with a repository linked — PrismaLens clones that repo under
   `~/.prismalens/repos` and the investigation runs inside the clone, never in
   your own checkout.
3. You land on the new incident (`INC-1`, **Alerts (0)**).
4. **Investigate** runs one agent session in the clone and streams it on the
   incident screen; the report renders beneath the ledger when it ends.

That is the same `incidents.create` and `incidents.investigate` path the
correlation engine uses, so nothing about the run is a mock.

### Or just the CLI

The same binary is a standalone investigator that needs nothing running:

```bash
npx prismalens doctor
```

`doctor` checks that a harness binary is on PATH, then `pl up` boots the app
(API and dashboard on one port, SQLite, no external services):

```bash
pl up
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

- **One run, no model call.** An investigation is one coding-agent session in a
  clone of the service's repo, driven over the Agent Client Protocol (ACP).
  PrismaLens assembles the prompt, answers the agent's permission requests,
  records the stream and validates the report. It never calls a model itself.
- **Bring your own harness.** Any ACP agent on PATH is a registry row:
  `opencode` (verified), `claude-code`, `codex`, `gemini`, `deepagents`. A row
  is auto-selected only after its unattended admission run is green in CI; the
  rest need `PRISMALENS_HARNESS=<id>`. Settings → Harness shows what is
  installed. The harness's own login or API key is its business; PrismaLens
  never reads or stores one.
- **Runtime gate, not read-only.** Every ACP permission request is answered in
  PrismaLens code: edit, delete and move tools and mutating shell commands are
  refused. It is a guardrail; `Bash` walks through text rules. The boundary is
  an enforced `--sandbox`, which confines writes and allowlists egress.
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
| `packages/@prismalens/engine` | The investigation run: ACP session, permission policy, stream adapter, report validation, sandbox. |
| `packages/@prismalens/contracts` | Shared Zod schemas and canonical event/report types. |
| `packages/@prismalens/config` | Shared config and environment-variable resolution. |
| `packages/@prismalens/auth` | Auth configuration and client (Better Auth), for the in-development server. |
| `packages/@prismalens/database` | SQLite database via Prisma — client, schema and the shipped migration runner. |
| `packages/@prismalens/integrations` | Integration templates, OAuth2 flows, credential encryption, for the in-development server. |
| `packages/@prismalens/logger` | Wide-events logging with tail sampling, shared across packages. |
| `packages/@prismalens/design-tokens` | Shared brand/design tokens for the (in-development) web UI. |
| `packages/api` | NestJS API server — shipped inside the `prismalens` tarball, booted by `pl up`. |
| `packages/frontend` | TanStack Start dashboard — built to static assets and served by the API on the same origin. |

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

