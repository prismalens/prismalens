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
| 2. AI provider | A provider and model, plus an API key if that provider needs one. The key is encrypted (AES-256-GCM) into this instance's database — never written to a file | Yes |
| 3. Code location | An absolute path to a git checkout on this machine, mapped to a service. This is the directory investigations actually read | Yes |
| 4. First incident | A hand-off into authoring your first incident, or connecting a monitoring tool | Yes |

**The wizard is resumable, and keeps no progress of its own.** Each step's
"done" is derived on the server from durable state — a user row, a stored
credential, a service with a checkout path, an incident row — so a reload, a
sign-in, or coming back tomorrow lands you on the first thing that is genuinely
still missing. See
[Setup wizard — the resume rule](docs/capabilities.md#setup-wizard--the-resume-rule)
for the worked transcript.

There is no Docker, no Redis and no separate frontend server: the tarball
carries the built dashboard and the API serves it from the same origin. Use
`--workspace <dir>` to put the database and secrets somewhere other than
`~/.prismalens`.

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

Your data stays where it is. PrismaLens keeps everything under `~/.prismalens`
(override with `PRISMALENS_WORKSPACE_DIR`) and never asks you to export, re-import,
or reset it.

From v0.5.0 — the release that adds the local app (`pl up`) and its database —
that guarantee has a mechanism behind it. Starting the app applies any pending
database migrations **in place**, and before it writes to a database that already
holds data it takes a backup alongside it as `prismalens.db.bak-<timestamp>`.
Migration history is append-only, so a newer release can advance an older
database whenever the history that database recorded matches the migrations the
release ships. If that history has drifted or is incomplete, `pl up` stops and
tells you how to reconcile it — it does not guess, and it does not write:

```console
$ pl up
Backed up /home/you/.prismalens/prismalens.db to /home/you/.prismalens/prismalens.db.bak-1785959532898 before migrating.
Applying migration 20260910084500_add_postmortem_owner…
Database migrated: 20260910084500_add_postmortem_owner
```

The reverse does not hold, and PrismaLens refuses rather than guesses. Downgrade
onto a database a newer release already migrated and it stops without touching
your data:

```console
$ pl up
Database migration refused [version-skew]
The database at /home/you/.prismalens/prismalens.db was written by a newer PrismaLens:
it records a migration this build does not ship (20260910084500_add_postmortem_owner).
Nothing was applied. Upgrade PrismaLens (`npm install -g prismalens@latest`), or point
PRISMALENS_WORKSPACE_DIR at a different directory to start fresh.
```

(Migration names above are illustrative — `pl up` and its database land in v0.5.0.)

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
| `packages/api` | NestJS API server — shipped inside the `prismalens` tarball, booted by `pl up`. |
| `packages/frontend` | TanStack Start dashboard — built to static assets and served by the API on the same origin. |
| `packages/worker` | The per-run investigation child the API's dispatch loop forks. |

Only `packages/cli` is published, under the name `prismalens`. Everything else
is `private: true` and travels INSIDE that one tarball as bundled dependencies:
`scripts/pack-cli.mjs` copies each built package into
`node_modules/@prismalens/<name>` and GENERATES the third-party dependency
union those copies resolve against. Read that script's header before changing
anything about packaging — it carries the reasoning, the installed layout, and
the two invariants that fail the pack.

What that actually produces:

```console
$ node scripts/pack-cli.mjs
==> copy closure (9): @prismalens/api, @prismalens/auth, @prismalens/config,
    @prismalens/contracts, @prismalens/database, @prismalens/engine,
    @prismalens/integrations, @prismalens/logger, @prismalens/worker
==> generated dependency union: 41 third-party packages
==> import scan: every bare specifier resolves
==> packages/cli/dist-pack/prismalens-0.4.0.tgz  1.25 MB, 536 entries
    bundleDependencies survived; no workspace:/catalog: strings

$ tar -tzf packages/cli/dist-pack/prismalens-0.4.0.tgz
package/dist/bin/prismalens.js                       # the pl / prismalens bin
package/node_modules/@prismalens/api/dist/src/main.js # NestJS, imported by pl up
package/node_modules/@prismalens/api/public/index.html          # the dashboard
package/node_modules/@prismalens/worker/dist/index.js  # forked per investigation
package/node_modules/@prismalens/database/prisma/sqlite/schema/20260803122809_init/migration.sql
package/node_modules/@prismalens/engine/package.json
...                                                          # 536 entries total
```

The 9 copied packages are `bundleDependencies`; the 41 third-party packages are
ordinary `dependencies` that npm installs beside them — which is exactly where
the copied packages' imports resolve, because Node resolution walks upward.

## Development

```bash
pnpm install

pnpm build           # turbo build across the workspace
pnpm test            # turbo test across the workspace
pnpm --filter @prismalens/frontend test:e2e # Playwright against the dev stack (needs ports 3000 and 3001 free)
pnpm pack            # build the published tarball (scripts/pack-cli.mjs)
sh scripts/packed-smoke.sh packages/cli/dist-pack # install it clean and boot `pl up` against it
pnpm typecheck       # turbo typecheck across the workspace
pnpm format-and-lint # biome check
```

To work on the CLI specifically, see
[`packages/cli/README.md`](packages/cli/README.md).

## Links

- Site: [prismalens.io](https://prismalens.io)
- Docs: [docs.prismalens.io](https://docs.prismalens.io)
- [Alert correlation & suppression](docs/alert-correlation.md) — the waterfall,
  rule actions, and how to un-suppress an alert
- [Capability catalog](docs/capabilities.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [VERSIONING.md](VERSIONING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)

## License

[Apache License 2.0](LICENSE) — see also [NOTICE](NOTICE). The hosted cloud /
enterprise edition is a separate, proprietary product.
