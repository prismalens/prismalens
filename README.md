<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png">
    <img alt="PrismaLens — your coding agent, investigating your incidents" src=".github/assets/banner-light.png" width="830">
  </picture>
</p>

PrismaLens investigates a firing alert the way an on-call engineer would: it
reads the repo, queries your read-only telemetry, and comes back with an
**ordered-evidence report** — hypotheses ranked most to least plausible, each
backed by evidence it actually gathered, with no fake numeric confidence
scores. It's open source (Apache-2.0), local-first, and BYO-key — no
PrismaLens account, no subscription. Before you run it on your machine, read
**[what PrismaLens reads and never does](https://docs.prismalens.io/trust/)**.

> [!WARNING]
> PrismaLens is **alpha**. Any 0.x release may change behaviour or break a
> workflow; read the [release notes](https://github.com/prismalens/prismalens/releases)
> before you upgrade. See [VERSIONING.md](VERSIONING.md).

## Install

### npm

Needs Node.js 24+.

```bash
npm install -g prismalens
```

To try it once without installing, run `npx prismalens@latest up`.

### macOS and Linux, without Node

```bash
curl -fsSL https://prismalens.io/install.sh | sh
```

### Windows, without Node (preview)

```powershell
irm https://prismalens.io/install.ps1 | iex
```

Both installers bring their own Node, check the download against the
release's `SHA256SUMS`, and put `pl` on your PATH.

### Homebrew, and Scoop (preview)

```bash
brew install prismalens/tap/prismalens
```

```powershell
scoop bucket add prismalens https://github.com/prismalens/scoop-bucket
scoop install prismalens
```

### Desktop app (preview)

Unsigned zips for macOS, Windows and Linux are attached to each
[GitHub Release](https://github.com/prismalens/prismalens/releases); your OS
will warn before opening one. Signed installers come with #697.

## Quick start

One package, one process, no external services. `pl up` runs the API and the
dashboard on a single port, creates a SQLite database in `~/.prismalens` on
first run, and applies its own migrations:

```bash
pl up                 # http://localhost:3001
pl up --port 8080     # or wherever you like
```

`pl up` opens your browser on a one-time link that pairs it as this machine's
session, and prints the link too; there is no account. Every browser pairs, this
machine's included, so nothing gets in by being local. Everything else is
configured in the dashboard. A coding agent must be installed on the machine for
investigations to run; `pl doctor` lists the ones PrismaLens knows, which are on
PATH, and how to install one (OpenCode, `curl -fsSL https://opencode.ai/install | bash`,
is first in the pick order). For each one on PATH it also opens an ACP handshake and
reports `ready` or the harness's own reason (for example "not logged in") — the
same check Settings → Agent runs on demand. PrismaLens never bundles,
installs or authenticates a harness. Set `PRISMALENS_HARNESS=<id>` to pin one.

There is no Docker, no Redis and no separate frontend server: the tarball
carries the built dashboard and the API serves it from the same origin. Use
`--workspace <dir>` to put the database and secrets somewhere other than
`~/.prismalens`. Logs are in `<workspace>/logs/`, the newest is `prismalens.<highest N>.log`;
`--verbose` streams them to the terminal. Webhook deliveries need the token in
`<workspace>/PRISMALENS_WEBHOOK_SECRET_FILE`: send it as
`Authorization: Bearer <token>` or as the basic auth password, or use it as the
HMAC-SHA256 key over the raw body and send `X-Hub-Signature-256: sha256=<hex digest>`.
Alertmanager: set `authorization: { credentials: <token> }` on the receiver. One alert by hand:

```bash
curl -X POST http://localhost:3001/api/webhooks/prometheus \
  -H "Authorization: Bearer $(cat ~/.prismalens/PRISMALENS_WEBHOOK_SECRET_FILE)" \
  -H 'Content-Type: application/json' \
  -d '{"status":"firing","alerts":[{"status":"firing","labels":{"alertname":"HighErrorRate","severity":"critical","service":"payments"},"annotations":{"summary":"5xx above 5% for 10 minutes"},"startsAt":"2026-09-18T12:00:00Z"}]}'
```

### Your first investigation

A fresh install has nothing pointed at it, so no incidents arrive on their own.
You do not need an Alertmanager to see it work:

1. **Install and start.** `npm install -g prismalens`, then `pl up`; it opens
   your browser on the link that pairs it, no account. `pl doctor` says whether a coding agent is on PATH, which model
   a run will ask it for. With OpenCode the
   model is `opencode/muse-spark-1.3-contributor-free`, keyless, unless you set
   another under Settings → Agent → Model.
2. **Point a service at its code.** Services, then Add Service, then set
   **Repository** to a folder (`~/code/payments`) or a git URL
   (`git@github.com:acme/payments.git`). Saving asks git and shows the answer
   on the service: `main at 3f2c9a1b04de`, or git's error word for word. A URL
   is mirrored under `~/.prismalens/repos/` with your own git credentials.
3. **Write the incident.** Incidents, then Create Incident. A title is the only
   required field; pick the service, or the run has no repository to read and
   the timeline says it ran unmapped.
4. **Run.** Investigate takes a fresh snapshot of the repository's last commit
   into `~/.prismalens/runs/<id>/repo` and runs one agent session there. Your
   checkout is never the working directory, and uncommitted changes are not
   read. The stream and then the report render on the incident.

That is the same `incidents.create` and `incidents.investigate` path the
correlation engine uses, so nothing about the run is a mock.

### Alerts on their own

Once a receiver posts to `/api/webhooks/prometheus`, nobody has to click. An alert
reaches a service through its `service` label: the value must equal a service's
name exactly. An alert that repeats the title and text of one already on an open
incident joins that incident; otherwise it opens a new one, and only the alert
that opens an incident decides whether an investigation starts. A new incident
with no service runs nothing, and the timeline says so. A critical or high alert
on a service starts an investigation on arrival; change that on the service's
Investigation tab (open the service from an incident, or from Settings →
Services): always, critical and high, critical only, never. When the policy says
no, the incident's timeline names the policy and where to change it.

### Or just the CLI

The same binary is a standalone investigator that needs nothing running:

```bash
npx prismalens doctor
```

`doctor` checks that a harness binary is on PATH and answers an ACP handshake, then `pl up` boots the app
(API and dashboard on one port, SQLite, no external services):

```bash
pl up
```

Both `prismalens` and the shorter `pl` alias point at the same binary. Full
setup (providers, harnesses, configuration, commands) lives at
**[docs.prismalens.io](https://docs.prismalens.io)**.

### Upgrading

```bash
pl upgrade
```

It upgrades the way you installed: npm, the installer, Homebrew or Scoop. `pl up`
says when a newer release is out. To uninstall, see
[Install, upgrade and uninstall](https://docs.prismalens.io/install/).

PrismaLens keeps data and run artifacts under `~/.prismalens`. Upgrade instructions and database migration details are documented at **[docs.prismalens.io](https://docs.prismalens.io)**.

## How it works

- **One run, no model call.** An investigation is one coding-agent session in a
  snapshot of the service's repo, driven over the Agent Client Protocol (ACP).
  PrismaLens assembles the prompt, answers the agent's permission requests,
  records the stream and validates the report. It never calls a model itself.
- **Bring your own harness.** Any ACP agent on PATH is a registry row:
  `opencode`, `claude-code`, `codex`, `gemini`, `deepagents`. With nothing
  pinned, the first one on PATH in that order runs; pin another with
  `PRISMALENS_HARNESS=<id>` or in Settings → Agent, which shows what is
  installed and the version each was tested with. The harness's own login or API key is its business; PrismaLens
  never reads or stores one.
- **Runtime gate, not read-only.** Every ACP permission request is answered in
  PrismaLens code: edit, delete and move tools and mutating shell commands are
  refused. It is a guardrail; `Bash` walks through text rules. There is no sandbox: the agent runs as your user on the machine that runs `pl up`, with an allowlisted environment and its working directory on a throwaway clone of the repo. Give it read-only credentials and pick that machine accordingly.
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
| `packages/@prismalens/engine` | The investigation run: ACP session, permission policy, stream adapter, report validation, child launch. |
| `packages/@prismalens/contracts` | Shared Zod schemas and canonical event/report types. |
| `packages/@prismalens/config` | Shared config and environment-variable resolution. |
| `packages/@prismalens/auth` | Auth configuration and client (Better Auth), for the in-development server. |
| `packages/@prismalens/database` | SQLite database via Prisma — client, schema and the shipped migration runner. |
| `packages/@prismalens/integrations` | Integration templates, OAuth2 flows, credential encryption, for the in-development server. |
| `packages/@prismalens/logger` | Pino-based structured logging with log rotation and secret redaction, shared across packages. |
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

[Apache License 2.0](LICENSE) — see also [NOTICE](NOTICE).
