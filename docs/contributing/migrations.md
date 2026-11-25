# Database migrations

Migration history is append-only (`AGENTS.md` → *Invariants*): never delete, edit, rename or squash a migration under `packages/@prismalens/database/prisma/sqlite/schema/`, and never tell anyone to delete `prismalens.db`. Installed databases record each migration's checksum, and the runner refuses an edited history rather than guess (#335).

## The lifecycle

The app migrates its own SQLite database at boot: `pl up` runs where there is no `pnpm`, `prisma` or schema source.

| Stage | Who | Where |
| --- | --- | --- |
| Author | you, once per schema change: `pnpm db:migrate` | `packages/@prismalens/database/prisma/sqlite/schema/<timestamp>_<name>/migration.sql` |
| Ship | `pnpm build`; `packages/@prismalens/database/scripts/copy-migrations.mjs` stages the SQL next to the compiled runner | `packages/@prismalens/database/dist/prisma/sqlite/schema/` |
| Detect | the runner, on every start: shipped migrations minus the rows in `_prisma_migrations` | `pnpm db:init` prints what it will apply |
| Apply and record | the runner, in one `BEGIN IMMEDIATE` transaction per migration, so nothing is half-applied | `pnpm exec prisma migrate status` agrees with it |

The runner writes `_prisma_migrations` the way Prisma does, so the Prisma CLI can read a database it created. A migration folder's name counts toward the Windows path limit (`docs/contributing/release-pipeline.md`).

## When the runner refuses

It never partially applies; each refusal leaves the database as found.

| `MigrationError.code` | What happened | What to do |
| --- | --- | --- |
| `pre-release-database` | created by a version before 0.5.0, whose lineage does not upgrade | move the file aside, or point `PRISMALENS_WORKSPACE_DIR` elsewhere |
| `version-skew` | the database records a migration this build does not ship: a newer PrismaLens wrote it | upgrade PrismaLens, or point `PRISMALENS_WORKSPACE_DIR` elsewhere |
| `checksum-mismatch` | a shipped migration's SQL differs from what was applied: an edited history | restore the migration file; never delete the database |
| `history-gap` | the recorded migrations are not an ordered prefix of the shipped ones | restore a validated backup |
| `incomplete-migration` | a started-but-unfinished row, reachable only through the Prisma CLI | restore a validated backup |
| `locked` | another PrismaLens process held the write lock for the whole retry budget | wait for it and retry |

Before applying anything to a database that holds data, the runner backs it up to `prismalens.db.bak-<epoch-ms>` beside it. Restore a validated backup, not simply the newest: it may have been taken just before the run that broke the database, from a state already wrong. Check candidates newest first and take the first whose history is an ordered prefix of the shipped migrations with no row where both `finished_at` and `rolled_back_at` are NULL:

```console
$ sqlite3 <candidate> "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name;"
```

`prisma migrate resolve --rolled-back` marks a row rolled back without reverting its schema changes, and the runner applies that migration again on the next start. Use it only when the migration is known to have changed nothing; otherwise restore a validated backup.
