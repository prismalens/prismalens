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
a Turborepo monorepo (NestJS API + TanStack Start UI + a per-run investigation child, with
Prisma/SQLite).

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

The dev login is `admin@prismalens.dev` / `admin123`. On first boot against an empty database, the owner account and demo data (~60 alerts, incidents, investigations) are provisioned automatically.

Auto-seeding only runs when `NODE_ENV=development`. To force the same seed outside development — e.g. in e2e tests or CI, where the API runs against an empty database with `NODE_ENV` unset or set to something else — set `PRISMALENS_SEED_DEMO=1`. It is an explicit opt-in: the flag is never set implicitly, and seeding still only happens once, against an empty database.

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
| **Author** | you, once per schema change | `packages/@prismalens/database/prisma/sqlite/schema/<timestamp>_<name>/migration.sql` (+ the `pg` twin) | `pnpm db:migrate` |
| **Ship** | `pnpm build` | `dist/prisma/<flavour>/schema/…` — `scripts/copy-migrations.mjs` stages the SQL next to the compiled runner, because `tsc` emits only JS | `ls packages/@prismalens/database/dist/prisma/sqlite/schema` |
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

When a migration introduces a new unique index on populated tables (such as `account(issuer, accountId)` in `20260826180000_account_issuer_account_id_unique`), pre-existing duplicate records cause the migration to **hard-stop and refuse to apply**. Automatic de-duplication is rejected by policy because deleting auth records unattended is unsafe. Neither lineage constructs a `MigrationError` for duplicate data.

What the operator sees:
- **PostgreSQL (`prisma migrate deploy`):** The PL/pgSQL pre-flight check raises an exception naming the offending `(issuer, accountId)` pairs, row IDs, and counts:
  ```
  Cannot create unique index on "account"("issuer", "accountId"): duplicate records found:
    - issuer="local:credential", accountId="dup_acc_100" (rows: a_cred_1, a_cred_2, count: 2)
  ```
  Prisma records the migration in `_prisma_migrations` with `finished_at` set to NULL. Subsequent runs of `prisma migrate deploy` abort with P3009 until this record is marked as rolled back.
- **SQLite (`pl up` / embedded runner):** The migration fails with a raw `SqliteError: UNIQUE constraint failed: account.issuer, account.accountId` and rolls back atomically, leaving the database and ledger untouched. Closing that gap in the runner is tracked as #496 ("db: the SQLite migration lineage refuses duplicate Account rows without reporting them").

What to do:
1. Run the diagnostic query to inspect the duplicate rows:
   - SQLite:
     ```console
     $ sqlite3 ~/.prismalens/prismalens.db \
         "SELECT issuer, accountId, GROUP_CONCAT(id, ', ') AS ids, COUNT(*) AS count
          FROM account
          GROUP BY issuer, accountId
          HAVING COUNT(*) > 1;"
     ```
   - PostgreSQL:
     ```sql
     SELECT "issuer", "accountId", string_agg("id"::text, ', ') AS ids, COUNT(*) AS count
     FROM "account"
     GROUP BY "issuer", "accountId"
     HAVING COUNT(*) > 1;
     ```
2. Manually resolve the duplicate records (e.g. re-assigning ownership or removing invalid stale accounts after human inspection).
3. On PostgreSQL, mark the failed migration record as rolled back before re-deploying:
   ```console
   $ pnpm exec prisma migrate resolve --rolled-back 20260826180000_account_issuer_account_id_unique --config prisma.config.ts
   ```
   SQLite does not require this step because the embedded runner rolls back atomically without recording a failed ledger row.
4. Re-run `pl up` (SQLite) or `pnpm exec prisma migrate deploy --config prisma.config.ts` (PostgreSQL).

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

PostgreSQL (the server placement) is out of the runner's scope and keeps using
`prisma migrate deploy` — a server deploy has the CLI.

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

Every first-party source file (`*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.mjs`,
`*.cjs`) starts with:

```
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
```

(after the shebang, for executables). CI enforces this via `pnpm spdx:check`.
Headers are automatically inserted when you commit; `pnpm spdx:fix` remains
available for manual runs. Generated code is excluded — paraglide
output, generated clients, anything under `dist/` — see the `EXCLUDE` list in
`scripts/spdx-headers.mjs`.

## Knowledge base (mage)

Durable design and spec knowledge lives in an **external mage hub**, not in this
repo — see [AGENTS.md](AGENTS.md). Before non-trivial work, read the hub's
`INDEX.md` and the `prismalens-platform` wing. When you learn something durable
(an interface detail, a gotcha, a decision), capture it as a note there rather
than letting it evaporate.

## Releases and package publishing

One package publishes to npm: `prismalens` (the CLI). Its first-party library
closure — `@prismalens/engine`, `@prismalens/contracts`, `@prismalens/config` —
is `private: true` and **bundled into the CLI tarball at build time** (tsup), so
it never publishes separately (see
[#193](https://github.com/prismalens/prismalens/issues/193)).
Versioning and publishing run through
[Changesets](https://github.com/changesets/changesets) (`.changeset/config.json`
+ `.github/workflows/release.yml`). CI enforces both changeset presence and naming
via `node scripts/validate-changesets.mjs` (`pnpm changeset:check`).

### Changeset rules

1. **When a changeset is required:** Any PR modifying publishable runtime code or
   assets under `packages/` must introduce or update a changeset in `.changeset/`.
   Changes that only touch documentation (`*.md`), tests (`*.test.*`, `*.spec.*`,
   `__tests__/`, `e2e/`, `eval/`), test configs (`vitest.config.*`, `playwright.config.*`),
   or repo tooling outside `packages/` (`scripts/`, `.github/`, `docs/`) do not require a changeset.
2. **Target package:** Every changeset must name **`prismalens`** — never a `@prismalens/*`
   package (see [`.changeset/README.md`](.changeset/README.md)).
3. **Escape hatch:** If a change touches publishable code but genuinely requires no
   release note or version bump (e.g. an internal refactor), commit an empty changeset
   using `pnpm changeset --empty` (or `npx changeset --empty`).
4. **Release PRs are exempt** — the machine-generated "chore: version packages" PR
   deletes the changesets it consumes, bumps `version` in the corresponding publishable
   packages, and can never add a changeset. See
   [Release PRs are exempt from the presence check](#release-prs-are-exempt-from-the-presence-check).
5. **Dependency-range bumps are exempt** — a `package.json` diff that only moves
   dependency *ranges* carries no code and therefore no release note. See
   [Dependency-range bumps are exempt from the presence check](#dependency-range-bumps-are-exempt-from-the-presence-check).
6. **The gate fails closed.** If it cannot compute the diff (a shallow clone, an
   unresolvable base ref, git unavailable) it exits non-zero with the git error
   attached. It never reports "no publishable packages modified" on a broken probe.

### Worked example

When modifying publishable code without a changeset, the gate fails:

```console
$ git diff --name-only origin/main
packages/api/src/modules/alerts/alerts.service.ts

$ pnpm changeset:check
No changeset found for changes to publishable packages.

Changed publishable files:
  • packages/api/src/modules/alerts/alerts.service.ts

Why this is required:
  This branch modifies code or assets that ship in the `prismalens` npm package.
  Every user-facing change to publishable code must carry a release note so the
  release train (issue #328) can version and publish the package.

How to fix:
  1. Add a changeset naming "prismalens" (patch for bug fixes, minor for features):
       pnpm exec changeset
     (or: npx changeset)

  2. Or if this change genuinely needs no release note (e.g. internal refactor),
     add an empty changeset escape hatch:
       pnpm exec changeset --empty
     (or: npx changeset --empty)
```

Adding a changeset satisfies the gate:

```console
$ pnpm changeset
# Select "prismalens", choose patch/minor, and enter a summary
🦋  Added changeset .changeset/cool-coder-ship.md

$ pnpm changeset:check
changesets OK — 28 changeset(s) validated; publishable set: prismalens.
```

### Release PRs are exempt from the presence check

The `changesets/action` release PR (branch `changeset-release/main`, title
`chore: version packages`) consumes changesets while bumping `version` in the
affected `package.json` files. In normal release mode, consumed changesets are
**deleted**; in Changesets **pre mode** (`.changeset/pre.json`), changesets are
preserved on disk and recorded in `pre.json`'s `changesets` array. Because those
manifests are publishable files, without an exemption the presence check would
fail on every release — on a PR no human can add a changeset to.

The exemption is decided from the **shape of the diff** and the **correspondence**
between consumed changesets (deleted `.changeset/*.md` files in normal mode, or
newly recorded IDs in `.changeset/pre.json` in pre mode) and version bumps, not from
the branch name or the author, both of which any contributor can forge. It applies
only when *all* of the following hold:

* the diff **consumes** at least one changeset (deleted `.changeset/*.md` or recorded in `.changeset/pre.json`),
* **every** changed publishable file is a `package.json` whose parsed before/after
  differ only in `version` and in dependency-range *values*
  (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`),
* **at least one** publishable package's `version` field actually changed in this diff, and
* **every** publishable package named by any consumed changeset (parsed from its frontmatter)
  has its `version` bumped in this diff (`consumedPackageNames ⊆ bumpedPackages`).

Notes on the correspondence invariant:

* **Empty changesets** (`changeset --empty`) name no packages. A release PR legitimately
  consumes them alongside regular changesets; they do not defeat the exemption.
* **Containment is one direction only**: `changeset version` also bumps dependent packages
  that no changeset explicitly named, so the bumped set may legitimately be larger.
* **Fails closed**: consumed changesets that cannot be read at the merge base (or from disk in pre mode)
  or whose frontmatter fails to parse deny the exemption.
* **Non-publishable names** (private / `.changeset/config.json` `ignore` entries) in consumed
  changesets are ignored because they never produce a version bump.

Adding or removing a dependency, retargeting one to an `npm:`/`file:`/git specifier,
touching any other manifest field (`bin`, `exports`, `scripts`, `files`, …), changing a
single line of source, or deleting/consuming changesets without matching version bumps aborts the
exemption.

When the exemption fires it says so on stdout, naming the consumed changesets and the
manifests it accepted:

```console
$ pnpm changeset:check
changeset presence check skipped — this is a Version Packages release PR:
  • it consumes 4 changeset(s): .changeset/dispatch-robustness.md, .changeset/fix-schema-recovery-trigger.md, .changeset/fix-stale-schema-crash.md, .changeset/refuse-listen-leak.md
  • every changed publishable file is a version-field-only package.json: packages/@prismalens/engine/package.json, packages/cli/package.json
  • branch: changeset-release/main
  See CONTRIBUTING.md → "Release PRs are exempt from the presence check".

changesets OK — release PR exempt from the presence check; 0 changeset(s) validated.
```

A release-shaped diff that smuggles in real source is refused, and the message names
the files that broke the shape:

```console
$ pnpm changeset:check
No changeset found for changes to publishable packages.

Changed publishable files:
  • packages/@prismalens/engine/package.json
  • packages/cli/package.json
  • packages/cli/src/index.ts

This branch deletes 4 changeset(s) the way a release PR does, but the release-PR exemption does not apply: 1 changed file(s) under packages/ are not version-field-only package.json edits:
  ✗ packages/cli/src/index.ts
...
```

A diff that deletes a changeset but does not bump the corresponding package version
(e.g., an attempted forge or unrelated changeset cleanup) is likewise refused:

```console
$ pnpm changeset:check
No changeset found for changes to publishable packages.

Changed publishable files:
  • packages/cli/package.json

This branch deletes 1 changeset(s) the way a release PR does, but the release-PR exemption does not apply: the deleted changeset(s) name publishable package(s) whose version was not bumped: prismalens
...
```

### Dependency-range bumps are exempt from the presence check

A Dependabot group bump — or a maintainer doing the same thing by hand — edits
`packages/*/package.json` and nothing else. Those manifests are publishable files, so
the presence check fired on them, and Dependabot cannot author a changeset.

Like the release-PR exemption, this one is decided from the **shape of the diff**. It
is deliberately **not** keyed on `dependabot[bot]` or any other identity: an author
check is forgeable in the same way a branch name is, and it would wrongly refuse a
human doing the identical, equally note-free change. The consequence is accepted —
**a human doing a pure dependency bump is exempt too.**

The exemption applies only when *all* of these hold:

* at least one changed `package.json` moves a dependency range, and
* **every** changed publishable file is a `package.json` whose parsed before/after
  differ *only* in dependency-range **values** under `dependencies`,
  `devDependencies`, `peerDependencies` or `optionalDependencies`, and
* no `version` field changed (that is the release-PR case, kept separate), and
* no changeset was deleted (likewise).

Adding or removing a dependency key, retargeting one away from a version range
(`npm:`, `file:`, `link:`, `git+…`, a tarball URL), touching any other manifest
field, or changing one line of source aborts it. `pnpm-lock.yaml` and the root
`package.json` are outside `packages/` and never counted either way.

```console
$ node scripts/validate-changesets.mjs --base '44506b6^'   # replaying #444, a Dependabot group bump
changeset presence check skipped — this is a dependency-range bump:
  • every changed publishable file is a dependency-range-only package.json: packages/@prismalens/logger/package.json, packages/api/package.json, packages/frontend/package.json
  • no source file, no other manifest field, no version bump, no changeset consumed
  • branch: dependabot/npm_and_yarn/dev-minor-patch-…
  See CONTRIBUTING.md → "Dependency-range bumps are exempt from the presence check".

changesets OK — dependency-range bump exempt from the presence check; 0 changeset(s) validated.
```

Smuggle anything else into that diff and it is refused, with the offending files named:

```console
$ node scripts/validate-changesets.mjs --base '44506b6^'
No changeset found for changes to publishable packages.

Changed publishable files:
  • packages/@prismalens/logger/package.json
  • packages/api/package.json
  • packages/api/src/main.ts
  • packages/frontend/package.json

This branch edits package.json the way a dependency bump does, but the dependency-bump exemption does not apply: 1 changed file(s) under packages/ are not dependency-range-only package.json edits:
  ✗ packages/api/src/main.ts
...
$ echo $?
1
```

**How the two exemptions interact.** Both are `every changed publishable file is …`
predicates evaluated over the same file list, so OR-ing them can never admit a file
neither would admit on its own. The dependency-bump file shape (ranges only) is a
strict subset of the release-PR file shape (ranges *and* `version`), which means the
union of what they accept is exactly what the release-PR exemption already accepted
before this rule existed. A diff that both deletes a changeset and edits dependency
ranges is handled by the release-PR branch, as it was before; add a new dependency key
or a source file to it and both branches refuse it.

### The gate fails closed when it cannot compute the diff

The presence check is only meaningful if the diff is known. A git failure that
produced an empty file list would read exactly like a branch that changed nothing —
a silent pass, which is the hole this gate exists to close. So every git invocation
that feeds the diff (`ls-files`, `merge-base`, `diff`) is fatal on failure, and git's
own stderr is printed rather than swallowed. This is why the CI `changesets` job
checks out with `fetch-depth: 0` (`.github/workflows/ci.yml`): a shallow clone has no
merge-base with the base branch.

```console
$ git clone --depth 1 … && GITHUB_BASE_REF=main pnpm changeset:check
Could not determine which files changed — refusing to pass.

  base ref: main
  git merge-base HEAD main — exit 128
    fatal: Not a valid object name main

Why this is fatal:
  This gate is only meaningful if the diff is known. An empty file list from a
  broken git invocation is indistinguishable from a branch that changed nothing,
  so it would pass silently forever — the exact hole issue #328 exists to close.

How to fix:
  1. In CI: check out with full history — `fetch-depth: 0` on actions/checkout.
     A shallow clone shares no merge-base with the base branch.
  2. Locally: fetch the base branch (`git fetch origin main`), or name one:
       node scripts/validate-changesets.mjs --base <ref>

$ echo $?
1
```

The one case where no diff is legitimate is a repository with **no commits yet** —
there is nothing to compare against and every file is untracked. That is handled by
name, not by the catch-all, and it says so:

```console
changesets OK — repository has no commits yet, so there is no diff to check; 1 changeset(s) validated.
```

### How a release reaches npm

On every push to `main` with pending changesets, the release workflow opens/updates a
**"chore: version packages" PR** (`pnpm changeset:version`); merging that PR publishes
the bumped `prismalens` package to npm with provenance (`pnpm changeset:publish` =
`node scripts/pack-cli.mjs --publish`, then `changeset tag`) and creates a
GitHub Release for its tag. That is NOT `pnpm publish -r`: the published tarball
carries the first-party closure as bundled dependencies, and `pnpm pack`
produces zero bundled entries — an artifact `pl up` cannot boot. The pack script
builds it, asserts it, and hands that exact file to `npm publish`, so what ships
is what the packed smoke verified. The version PR is opened with the
`RELEASE_PAT` repo secret (fine-grained PAT, Contents + Pull requests read/write
— the PR must come from a user so CI triggers on it). npm publishing uses
**trusted publishing** (OIDC): `prismalens` registers this repo's `release.yml`
as a trusted publisher on npmjs.com, the npm CLI exchanges the workflow's OIDC
token for a short-lived credential, and provenance is attested automatically — there
is no npm token secret to rotate or leak.

The same steps can be run manually from a local checkout as a fallback:
`pnpm changeset:version` → review/commit → `pnpm build && pnpm test &&
pnpm publint` → `pnpm run pack && sh scripts/packed-smoke.sh packages/cli/dist-pack`
→ `pnpm changeset:publish` → `git push --follow-tags`.

Everything else in `packages/` stays `private: true` and is never published on
its own — but since #237 the app-side packages (`@prismalens/api`,
`@prismalens/worker`) and the shared libraries travel INSIDE the `prismalens`
tarball as bundled dependencies, which is what makes `pl up` a single install.
They are still excluded from Changesets: one published package, one version.

### Prerelease (RC) workflow with Changesets pre mode

For major or milestone cuts (such as the v0.5.0 release candidate train), prismalens uses
Changesets' **pre mode** (`.changeset/pre.json`). Pre mode allows publishing prerelease iterations
(e.g., `0.5.0-rc.0`, `0.5.0-rc.1`) to the npm `rc` dist-tag without moving the `latest` tag used by
general installs.

> [!IMPORTANT]
> **Operator-only release train command on `main` — never commit `pre.json` in a feature PR.**
> Entering and exiting pre mode (`pnpm changeset pre enter <tag>` and `pnpm changeset pre exit`) is an
> **operator-run action executed directly on `main`, never part of a feature PR**. Committing `.changeset/pre.json`
> flips the entire repository into prerelease mode the moment it merges, which would force every pending
> changeset across the repo to bump to prerelease versions (`0.x.y-rc.N`) rather than stable releases.
> The operator controls the release train on `main`.

#### Lifecycle in pre mode

1. **Operator enters pre mode on `main`:** The repository operator runs `pnpm changeset pre enter rc` directly
   on `main` (or on a dedicated operator release branch landed to `main`). This writes `.changeset/pre.json` with
   `"mode": "pre"` and `"tag": "rc"`.
2. **The Version Packages PR:** On push to `main` with pending changesets, the release workflow
   (`.github/workflows/release.yml`) runs `pnpm changeset:version`. In pre mode, changesets are not deleted from
   disk; their IDs are appended to `.changeset/pre.json`'s `changesets` array, and `packages/cli/package.json` is
   bumped to `0.x.y-rc.N` (e.g., `0.5.0-rc.0`). CI recognizes this shape and exempts the PR from the changeset
   presence check.
3. **Publishing to the `rc` dist-tag:** When the Version PR merges to `main`, `release.yml` invokes
   `pnpm changeset:publish` (`node scripts/pack-cli.mjs --publish && changeset tag`). The pack script
   detects pre mode from `.changeset/pre.json` (or the prerelease version) and automatically supplies
   `--tag rc` to `npm publish`. This publishes `prismalens@0.5.0-rc.0` to the `rc` dist-tag without
   moving `latest`.
4. **User installation:** Users install the release candidate explicitly via:
   ```console
   $ npm i -g prismalens@rc
   ```
5. **Verifying dist-tags:** Confirm on npm that `latest` remains untouched and `rc` points to the candidate:
   ```console
   $ npm view prismalens dist-tags
   { latest: '0.4.0', rc: '0.5.0-rc.0' }
   ```
6. **Subsequent RC iterations:** Any subsequent changesets merged to `main` update the Version PR to
   bump the candidate version (`0.5.0-rc.1`, `0.5.0-rc.2`, etc.).
7. **Operator exits pre mode for the final release:** When the release candidate cycle is complete and the
   software is ready for stable release:
   - The operator runs `pnpm changeset pre exit` directly on `main`. This updates `.changeset/pre.json` to `"mode": "exit"`.
   - The operator commits and pushes `.changeset/pre.json` to `main`.
   - The subsequent release workflow run on `main` executes `pnpm changeset:version`, which consumes all queued
     changesets, bumps `packages/cli/package.json` to the final stable version (`0.5.0`), deletes all consumed
     `.changeset/*.md` files, and removes `.changeset/pre.json`.
   - Merging that Version PR publishes `0.5.0` to the `latest` dist-tag on npm via `node scripts/pack-cli.mjs --publish`.

#### Worked terminal transcript

The full transcript of entering pre mode, exercising the RC cycle, and exiting:

```console
# --- Step 1: Operator enters pre mode on main ---
$ pnpm changeset pre enter rc
🦋  success Entered pre mode with tag rc
🦋  info Run `changeset version` to version packages with prerelease versions

$ cat .changeset/pre.json
{
  "mode": "pre",
  "tag": "rc",
  "initialVersions": {
    "@prismalens/api": "0.0.1",
    "@prismalens/auth": "0.0.1",
    "@prismalens/config": "0.3.0",
    "@prismalens/contracts": "0.1.1",
    "@prismalens/database": "0.0.1",
    "@prismalens/design-tokens": "0.0.1",
    "@prismalens/engine": "0.2.1",
    "@prismalens/frontend": "0.0.1",
    "@prismalens/integrations": "0.0.1",
    "@prismalens/logger": "0.0.1",
    "@prismalens/worker": "0.0.1",
    "prismalens": "0.4.0"
  },
  "changesets": []
}

$ git add .changeset/pre.json
$ git commit -m "chore(release): enter rc pre mode"
$ git push origin main

# --- Step 2: Release workflow on main versions packages for RC ---
# In CI on main, changesets/action runs `pnpm changeset:version`
$ pnpm changeset:version
🦋  warn ===============================IMPORTANT!===============================
🦋  warn You are in prerelease mode
🦋  warn If you meant to do a normal release you should revert these changes and run `changeset pre exit`
🦋  warn You can then run `changeset version` again to do a normal release
🦋  warn ----------------------------------------------------------------------
🦋  All files have been updated. Review them and commit at your leisure

$ git status
On branch changeset-release/main
Changes not staged for commit:
	modified:   .changeset/pre.json
	modified:   packages/cli/CHANGELOG.md
	modified:   packages/cli/package.json

$ git diff packages/cli/package.json
-	"version": "0.4.0",
+	"version": "0.5.0-rc.0",

# --- Step 3: Version PR is validated by CI and merged ---
$ pnpm changeset:check
changeset presence check skipped — this is a Version Packages release PR:
  • it consumes 30 changeset(s): .changeset/alert-mapping-health.md, ...
  • every changed publishable file is a version-field-only package.json: packages/cli/package.json
  • branch: changeset-release/main
changesets OK — release PR exempt from the presence check; 30 changeset(s) validated.

# --- Step 4: Release workflow publishes to npm on the rc dist-tag ---
# Merging the Version PR triggers `release.yml` -> `pnpm changeset:publish`
$ node scripts/pack-cli.mjs --publish
==> building every package (turbo)
...
==> npm pack
prismalens-0.5.0-rc.0.tgz
==> packages/cli/dist-pack/prismalens-0.5.0-rc.0.tgz  1.26 MB, 523 entries
    bundleDependencies survived; no workspace:/catalog: strings
==> npm publish /home/runner/work/prismalens/prismalens/packages/cli/dist-pack/prismalens-0.5.0-rc.0.tgz --access public --tag rc
+ prismalens@0.5.0-rc.0

# --- Step 5: User installs and operator verifies dist-tags ---
$ npm view prismalens dist-tags
{ latest: '0.4.0', rc: '0.5.0-rc.0' }

$ npm i -g prismalens@rc
+ prismalens@0.5.0-rc.0
added 42 packages in 3.12s

$ prismalens --version
0.5.0-rc.0

# --- Step 6: Operator exits pre mode on main for the final stable release ---
$ pnpm changeset pre exit
🦋  success Exited pre mode
🦋  info Run `changeset version` to version packages with normal versions

$ cat .changeset/pre.json
{
  "mode": "exit",
  "tag": "rc",
  "initialVersions": {
    "@prismalens/api": "0.0.1",
    "@prismalens/auth": "0.0.1",
    "@prismalens/config": "0.3.0",
    "@prismalens/contracts": "0.1.1",
    "@prismalens/database": "0.0.1",
    "@prismalens/design-tokens": "0.0.1",
    "@prismalens/engine": "0.2.1",
    "@prismalens/frontend": "0.0.1",
    "@prismalens/integrations": "0.0.1",
    "@prismalens/logger": "0.0.1",
    "@prismalens/worker": "0.0.1",
    "prismalens": "0.4.0"
  },
  "changesets": [
    "alert-mapping-health",
    "..."
  ]
}

$ git add .changeset/pre.json
$ git commit -m "chore(release): exit rc pre mode"
$ git push origin main
# (Release workflow on main runs `pnpm changeset:version`, bumping packages/cli to 0.5.0, deleting changesets & pre.json, and publishing to latest tag upon merge)
```

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
- `release: RN (<Name>)`. The release checklist itself, covering changesets,
  prerelease verification against npm, closure of the docs and live-test exit
  issues, and narrative release notes.

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
