# Contributing to prismalens

Thanks for your interest in improving prismalens — a local-first SRE
incident-investigation tool.

## Contribution status

**prismalens is open source (Apache-2.0) but is not accepting outside code
contributions yet.** The codebase is moving fast pre-1.0 and the review
bandwidth goes into the release. What IS very welcome right now: bug reports,
feature requests, and discussions — use the issue templates. Forking is of
course fine; that's what the license is for.

When code contributions open, they will be gated by the Developer Certificate
of Origin (DCO, `Signed-off-by` on every commit) under Apache-2.0
inbound=outbound. This section will be updated when that happens.

Alongside the DCO, a one-time **Contributor License Agreement** ([CLA.md](CLA.md))
will apply. It exists purely for IP hygiene — it keeps the Project's copyright in
one clean place, as is standard for open-core projects (Grafana, Sentry) — and it
does not change the license: your contributions remain licensed to everyone under
Apache-2.0, inbound = outbound. It is **not in force yet**: no CLA check runs on
pull requests while outside code contributions remain closed, and the signing
mechanism will be introduced at the same time they open, not before. Nothing is
required of you until then.

## Ground rules

- **The trunk branch is `main`, and it is protected.** Every change lands
  through a pull request; direct pushes to the trunk are not allowed (for
  anyone, including the maintainer).
- **Never commit secrets.** No API keys, tokens, connection strings, or private
  content. prismalens runs against real infrastructure under read-only
  credentials by design — keep that contract intact.
- Keep PRs focused. One logical change per PR makes review fast.

## Development setup

Requirements: **Node >= 22** and **pnpm** (this repo pins pnpm via the
`packageManager` field; `corepack enable` will select the right version). It is
a Turborepo monorepo (NestJS API + TanStack Start UI, with Prisma/SQLite).

```bash
git clone https://github.com/prismalens/prismalens.git
cd prismalens
pnpm install

pnpm build        # turbo run build
pnpm typecheck    # turbo run typecheck
pnpm test         # turbo run test
pnpm --filter @prismalens/frontend test:e2e  # Playwright e2e smoke suite (boots isolated workspace via PRISMALENS_WORKSPACE_DIR + seeded demo data; requires ports 3000 and 3001 free)
pnpm format-and-lint        # biome check . (lint + format)
pnpm format-and-lint:fix    # biome check . --write
```

Run the app locally (API + frontend):

```bash
pnpm db:init      # initialise the local SQLite database
pnpm dev          # turbo run dev (or dev:api / dev:frontend)
```

The dev login is `admin@prismalens.dev` / `admin123`. `pnpm db:init` on an empty database seeds the owner account and demo data (~60 alerts, incidents, investigations) when `NODE_ENV=development` or `PRISMALENS_SEED_DEMO=1` — the same gate e2e tests and CI use to force it outside development. `pnpm --filter @prismalens/database db:seed` reruns the seed directly.

### Browser e2e tier

The Playwright suite runs in CI as its own workflow (`.github/workflows/e2e.yml`, chromium-only) on
every pull request and on pushes to `main`. It is **not a required check yet** — it is promoted to
required when the last 20 `main`-branch runs are green *and* none of them consumed a Playwright
retry, and once the storm-intake spec has landed. The rationale, the promotion trigger, and the
journey-by-journey coverage matrix live in
[`packages/frontend/e2e/README.md`](packages/frontend/e2e/README.md).

Two things to know before running it locally:

- The harness binds ports **3000 and 3001** with `reuseExistingServer: false`, so **stop `pnpm dev`
  first** — it will not share a running dev stack.
- On failure, CI uploads the `playwright-report` artifact (7-day retention); read that rather than
  re-running blind.

Every PR touching `packages/frontend` ships or extends a spec covering its changed surface, and
updates the coverage matrix if it adds or removes a route (see `AGENTS.md`).

## Database migrations

**Migration history is append-only.** Never delete, edit, rename, or squash a
migration under `packages/@prismalens/database/prisma/{sqlite,pg}/schema/`, and
never tell anyone to delete `prismalens.db`. Installed copies of PrismaLens
record each migration's checksum; an edited history is unreconcilable with a
database that already exists, and the runner refuses rather than guessing.

(This replaces an earlier development-phase rule that said to squash the `init`
migration and delete the database. It was safe only while every database in the
world belonged to a contributor — see issue #335.)

### The lifecycle, end to end

SQLite app-data databases are migrated **by the app itself, at boot**, not by the
Prisma CLI: `pl up` runs on a machine with no `pnpm`, no `prisma` binary, and no
schema source. Four stages, and what carries each:

| Stage | Who does it | Where it lives | How to see it |
|---|---|---|---|
| **Author** | you, once per schema change | `packages/@prismalens/database/prisma/sqlite/schema/<timestamp>_<name>/migration.sql` | `pnpm db:migrate` |
| **Ship** | `pnpm build` | `dist/prisma/sqlite/schema/…` — `scripts/copy-migrations.mjs` stages the SQL next to the compiled runner, because `tsc` emits only JS | `ls packages/@prismalens/database/dist/prisma/sqlite/schema` |
| **Detect** | the runner, on every app start | shipped migrations minus the rows in `_prisma_migrations` | `pnpm db:init` prints what it will apply |
| **Apply + record** | the runner, in one `BEGIN IMMEDIATE` transaction | the SQL runs and its `_prisma_migrations` row is written **in the same transaction** — there is no half-applied state to repair | `pnpm exec prisma migrate status` agrees with it |

The runner writes `_prisma_migrations` byte-for-byte the way Prisma does
(identical DDL, sha256-of-the-file checksum, `applied_steps_count = 1`), so a
database it created stays legible to the Prisma CLI:

```
$ pnpm db:init
🔍 Checking database state...
   Database type: sqlite
   Migrations path: prisma/sqlite/schema
   Database file: /home/you/.prismalens/prismalens.db
   Database exists: false
   Applying migration 20260803122809_init…
   Applied 1 migration(s): 20260803122809_init.
🔄 Applied: 20260803122809_init
✅ Database initialization complete

$ pnpm db:init                      # again — nothing pending
   Database is up to date (1 migration(s) applied).
✅ All migrations are up to date

$ pnpm exec prisma migrate status --config prisma.config.ts
Database schema is up to date!
```

### When the runner refuses

It never partially applies. Each of these leaves the database exactly as found:

| `MigrationError.code` | What happened | What to do |
|---|---|---|
| `version-skew` | the database records a migration this build does not ship — it was written by a newer PrismaLens | upgrade PrismaLens, or point `PRISMALENS_WORKSPACE_DIR` elsewhere |
| `checksum-mismatch` | a shipped migration's SQL differs from what was applied — an edited or squashed history | restore the migration file; history is append-only. If the edit already shipped, see *Recovering a database that drifted* below — **never** delete the database |
| `history-gap` | the recorded migrations are not an ordered prefix of the shipped ones — a gap or a duplicate row | restore a *validated* `prismalens.db.bak-*` (see below), or reconcile with the Prisma CLI |
| `incomplete-migration` | a row is started-but-unfinished on SQLite (reachable only via the Prisma CLI, not this runner) | restore a *validated* `prismalens.db.bak-*` (see below). `prisma migrate resolve --rolled-back` clears the ledger row only without reverting schema changes, and is correct only when confirmed that no schema changes occurred or after manually reverting partial schema changes |
| `locked` | another PrismaLens process held the write lock for the whole retry budget | wait for it and retry |

Before applying anything to a database that already holds data, the runner takes
an online backup to `prismalens.db.bak-<epoch-ms>` next to it.

**"Restore the backup" means restore a *validated* one — not simply the newest.**
The newest backup may be the one taken immediately before the run that produced
the broken state. Check each candidate, newest first, and use the first whose
history is an ordered prefix of the shipped migrations with no unfinished rows:

```console
$ sqlite3 <candidate>.bak-<epoch-ms> \
    "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
      ORDER BY migration_name;"
```

Reject it if any `finished_at` is NULL while `rolled_back_at` is NULL (that is the
`incomplete-migration` state again), or if the names are not a leading subsequence
of the migration directories this build ships. Only then copy it over
`prismalens.db` and start the app.

`prisma migrate resolve --rolled-back` writes `rolled_back_at` into `_prisma_migrations`
without reverting schema changes. Because the runner computes pending migrations by
filtering for `rolled_back_at === null`, a rolled-back migration runs again on the
next start against whatever schema state remains. Using `--rolled-back` is correct only
when confirmed that the migration failed before applying schema changes, or after
manually reverting partial schema changes first. Restoring a validated backup is the
remedy when schema state is not certain.

### Refuse-and-report on duplicate data

When a migration introduces a new unique index on populated tables (such as `account(issuer, accountId)` in `20260826180000_account_issuer_account_id_unique`), pre-existing duplicate records cause the migration to **hard-stop and refuse to apply**. Automatic de-duplication is rejected by policy because deleting auth records unattended is unsafe. The runner does not construct a `MigrationError` for duplicate data.

What the operator sees: the migration fails with a raw `SqliteError: UNIQUE constraint failed: account.issuer, account.accountId` and rolls back atomically, leaving the database and ledger untouched. Closing that gap in the runner is tracked as #496 ("db: the SQLite migration lineage refuses duplicate Account rows without reporting them").

What to do:
1. Run the diagnostic query to inspect the duplicate rows:
   ```console
   $ sqlite3 ~/.prismalens/prismalens.db \
       "SELECT issuer, accountId, GROUP_CONCAT(id, ', ') AS ids, COUNT(*) AS count
        FROM account
        GROUP BY issuer, accountId
        HAVING COUNT(*) > 1;"
   ```
2. Manually resolve the duplicate records (e.g. re-assigning ownership or removing invalid stale accounts after human inspection).
3. Re-run `pl up`.

### Recovering a database that drifted

`checksum-mismatch` is the one failure a released build can inflict on a database
that did nothing wrong: the `init` migration was edited in place three times
(#350, #352, #357) before this rule existed, so any database created before those
landed records a checksum no current build ships. Deleting the file "fixes" it and
destroys the operator's incident and investigation history. It is repairable in
place instead, and the runner's error message spells the repair out.

The ledger is the runner's only source of truth, so re-pointing the checksum alone
makes the error disappear **and leaves the schema wrong** — the DDL the edit added
is still missing. Apply the DDL and re-point the ledger in ONE transaction.

**Step 0 — take a copy you can roll back to.** Everything below is reversible only
because of this. Stop the app first, then:

```console
$ cp ~/.prismalens/prismalens.db ~/.prismalens/prismalens.db.pre-repair
```

To roll back at any point: `mv ~/.prismalens/prismalens.db.pre-repair ~/.prismalens/prismalens.db`.

**Step 1 — find what your schema is missing.** Build a reference database from the
release you are moving to and compare table lists:

```console
$ export REF=$(mktemp -d)
$ PRISMALENS_WORKSPACE_DIR=$REF pl up      # ctrl-c once it says it is listening
$ sqlite3 $REF/prismalens.db  ".tables" | tr -s ' ' '\n' | sort > /tmp/want.txt
$ sqlite3 ~/.prismalens/prismalens.db ".tables" | tr -s ' ' '\n' | sort > /tmp/have.txt
$ comm -23 /tmp/want.txt /tmp/have.txt     # tables you are missing
$ sqlite3 $REF/prismalens.db ".schema <table>"   # the CREATE statements to copy
```

Compare columns per table the same way with `PRAGMA table_info(<table>);`.

**Step 2 — apply the DDL and re-point the ledger, atomically.** The SQL below is
written for exactly one drift: the one #350/#352/#357 introduced, which is the
only one in the wild today. **Before running it, confirm step 1's diff shows
nothing but** the missing `jobs` table, its three indexes, and
`services.localCheckoutPath`. If the diff shows anything else, or a migration
other than `20260803122809_init` is named in the error, stop — this recipe does
not describe your drift, and you need the actual delta for your case.

The checksum to write is the one the error message printed as *"shipped by this
build"*; for the `20260803122809_init` drift it is
`0e7aa00150d19520db40e2faf4400c93e317e19051d891dced3541e147b7ab76`. Confirm it
matches your error before running this — a checksum copied from documentation is
only correct for the release it was written against.

```sql
BEGIN;
ALTER TABLE "services" ADD COLUMN "localCheckoutPath" TEXT;
-- paste the exact CREATE TABLE "jobs" (…) from step 1's `.schema jobs`
CREATE UNIQUE INDEX "jobs_investigationId_key" ON "jobs"("investigationId");
CREATE INDEX "jobs_status_runAt_priority_idx" ON "jobs"("status", "runAt", "priority");
CREATE INDEX "jobs_status_heartbeatAt_idx" ON "jobs"("status", "heartbeatAt");

UPDATE "_prisma_migrations"
   SET checksum = '0e7aa00150d19520db40e2faf4400c93e317e19051d891dced3541e147b7ab76'
 WHERE migration_name = '20260803122809_init';

-- Must print 1. Anything else means the ledger is not what this recipe assumes:
-- ROLLBACK instead of COMMIT.
SELECT changes();
COMMIT;
```

**Step 3 — validate.** The ledger must match the shipped SQL, and the app must boot:

```console
$ sqlite3 ~/.prismalens/prismalens.db \
    "SELECT migration_name, checksum FROM _prisma_migrations;"
$ pl up      # expect "Database is up to date (1 migration(s) applied)."
```

If `pl up` still refuses, roll back with the copy from step 0 and open an issue
with the error text — do not delete the database.

A database repaired this way is schema-identical to a fresh one; only the ordinal
position of an `ALTER TABLE`-added column differs, which Prisma does not depend on.

## Making a change

1. **Branch** off `main`: `git checkout -b fix/short-description main`.
2. **Work test-first (repo policy since #58): new code ships with tests written
   at its public seams and ≥80% per-metric coverage.** Vitest enforces this via
   per-glob `coverage.thresholds` (see `packages/cli/vitest.config.ts`) — when
   you add a module, add it (or its directory) to that map; reviewers treat a
   new source file with no threshold entry as a missing test. Pre-existing
   files are exempt until touched. Fix the implementation, not the test,
   unless the test is wrong.
3. Make sure `pnpm typecheck`, `pnpm build`, `pnpm test`, and
   `pnpm format-and-lint` all pass.
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `perf:`.
5. **Open a PR** against `main`. The **PR title** must be a valid conventional
   commit — a required check enforces it (the repo squash-merges, so the PR
   title becomes the trunk commit subject).

## Code style

- Formatting and linting are handled by **Biome** — run `pnpm format-and-lint`.
- **Never convert tabs to spaces or vice-versa.** Preserve the existing
  indentation of each file exactly.
- Small, cohesive files; explicit error handling at boundaries; no stray
  `console.log` debris and no hardcoded secrets.

## License headers (SPDX)

New source files carry the same two-line SPDX header as their neighbours
(`// SPDX-License-Identifier: Apache-2.0` / `// Copyright 2026 Sumit Patel`).
Nothing enforces it.

## Knowledge base (mage)

Durable design and spec knowledge lives in an **external mage hub**, not in this
repo — see [AGENTS.md](AGENTS.md). Before non-trivial work, read the hub's
`INDEX.md` and the `prismalens-platform` wing. When you learn something durable
(an interface detail, a gotcha, a decision), capture it as a note there rather
than letting it evaporate.

## Releases and package publishing

One package publishes to npm: `prismalens` (the CLI). Its first-party library
closure is `private: true` and bundled into the CLI tarball at build time, so
it never publishes separately (issue #193).

Versioning and publishing run through
[release-please](https://github.com/googleapis/release-please)
(`release-please-config.json` + `.release-please-manifest.json` +
`.github/workflows/release.yml`), driven by conventional-commit titles on
`main` — there are no changesets and no pre-release tags (0001 §7, §9).

1. Every commit to `main` needs a conventional-commit title (`fix:`, `feat:`,
   `chore:`, …); release-please reads these to compute the next version.
2. On push to `main`, release-please opens or updates a release PR proposing
   the next version and a changelog.
3. Merging that PR creates the GitHub Release and tag, which triggers the
   `publish` job: build, `publint`, then pack + publish via npm trusted
   publishing (OIDC) — no npm token secret.
4. Override the computed version with a `Release-As: 0.5.0`-style footer on a
   commit to `main`.

The release PR is created with the `RELEASE_PAT` repo secret, not the default
`GITHUB_TOKEN`: this repo forbids Actions from creating PRs, and a PR opened
with `GITHUB_TOKEN` never triggers CI (GitHub anti-recursion).

## Documentation and milestone exit gates

Product documentation lives on the documentation website at
[docs.prismalens.io](https://docs.prismalens.io), built from the source repository
[`prismalens/prismalens.io`](https://github.com/prismalens/prismalens.io). This repository carries
only the root `README.md`, package `README.md` files, and contributor process
documentation.

Every release milestone (`R1` through `R5`) carries three standing exit issues
created when the milestone is created. All three carry the `post-release` label
and are assigned to that milestone:

- `docs: RN (<Name>) exit criteria`. The milestone does not close until
  docs.prismalens.io documents every command, flag, and configuration key shipped
  in the release, with input and output symmetry, validated links on the built
  site, and an adversarial docs review.
- `live-test: RN (<Name>) exit gate`. A scripted live test runs against the
  packed tarball, not the source tree, across incident scenarios relevant to the
  release.
- `release: RN (<Name>)`. The release checklist itself, covering the
  release-please PR, verification against npm, closure of the docs and
  live-test exit issues, and narrative release notes.

In these exit issues, "Docs" means the published website at docs.prismalens.io.
Repository markdown files and package READMEs do not satisfy the documentation
gate. A release can have a complete repository README and still fail the gate if
shipped features lack published documentation on the website.

## Reporting bugs and requesting features

Use the issue templates. For anything security-sensitive, **do not open a public
issue** — see [SECURITY.md](SECURITY.md).

## License

prismalens is distributed under the [Apache License 2.0](LICENSE) (see also
[NOTICE](NOTICE)). The hosted cloud / enterprise edition
(`prismalens-enterprise`) is a separate, **proprietary** product and carries
none of this repository's licensing. This repository's license is not
changing — paid features are developed in the separate proprietary repo and
never move out of (or into) this one.

If and when outside code contributions are accepted (see
[Contribution status](#contribution-status)), contributors will sign a
lightweight **Contributor License Agreement (CLA)** in addition to DCO
sign-off. The CLA exists for IP hygiene — keeping the project's copyright in
one clean place, as is standard for open-core projects (Grafana, Sentry) — and
contributions remain licensed to everyone under Apache-2.0, inbound=outbound.
