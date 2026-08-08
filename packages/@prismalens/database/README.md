# @prismalens/database

Prisma client and database adapter for the in-development server.
This package is `private: true` and meant for Node server environments.

## Migration runner (`@prismalens/database/migrator`)

The shipped SQLite migration runner. Applies pending migrations programmatically —
no `prisma` binary, no `pnpm`, no schema source — because `pl up` runs on an end
user's machine where none of those exist.

```ts
import { getConfig } from "@prismalens/config";
import { runMigrations } from "@prismalens/database/migrator";

// Called from packages/api/src/main.ts before Nest starts.
const result = await runMigrations({
	dbType: getConfig().PRISMALENS_DB_TYPE,
	log: (message) => console.info(message),
});

console.info(result.status, result.applied, result.backupFile);
```

`result.status` is `"applied"`, `"up-to-date"`, or `"skipped-non-sqlite"`;
`applied` lists what this run changed, and `backupFile` is the pre-migration
backup path when one was taken.

Importing this subpath does **not** construct a `PrismaClient`, so the database
can be migrated before anything opens it.

| Concern | How it is handled |
|---|---|
| Finding the SQL in a packed install | `dist/` mirrors the package root (`rootDir: "."`), so `dist/src/migrator/…` resolves `../../prisma/<flavour>/schema` to `dist/prisma/<flavour>/schema`. `scripts/copy-migrations.mjs` stages the SQL there at build time. Resolution order, highest first: the `migrationsDir` option to `runMigrations`, then `PRISMALENS_MIGRATIONS_DIR`, then the first existing candidate path. |
| Idempotency | `_prisma_migrations` is the ledger: pending = shipped minus recorded. A second run is a read-only no-op. |
| Concurrency | One `BEGIN IMMEDIATE` transaction per run, ledger re-read **after** the lock is held. A losing process waits out `busy_timeout`, retries, and applies nothing. |
| Crash mid-apply | SQLite DDL is transactional, and the ledger row is written in the same transaction — the whole pass rolls back together. |
| Prisma parity | Identical `_prisma_migrations` DDL, sha256-of-file checksum, `applied_steps_count = 1`. `prisma migrate status` agrees with a database this runner created. |
| PostgreSQL | Skipped (`skipped-non-sqlite`). Server placements have the Prisma CLI and use `prisma migrate deploy`. |

Migration history is **append-only** — see
[Database migrations](../../../CONTRIBUTING.md#database-migrations).

## Demo Data Seeding

Demo data seed logic lives in `prisma/seeds/demo-data.ts`.
It provisions monitored services, correlation rules, incidents, alerts, and investigations for empty dev databases.

To extend the demo dataset:
1. Add or modify seed functions in `prisma/seeds/`.
2. Export a function that accepts `SeedPrismaClient` (or `PrismaClient`).
3. Call it from `seedDemoData` in `prisma/seeds/demo-data.ts`.
