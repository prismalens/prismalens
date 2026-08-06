// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Apply the shipped SQLite migration SQL programmatically, through the same
 * better-sqlite3 driver the app runs on.
 *
 * WHY THIS EXISTS: `pl up` boots from an npm tarball. The `prisma` CLI is a
 * devDependency and is deliberately NOT in the published closure — invoking it
 * at user runtime would either fail or drag a second copy of the toolchain into
 * every install. So the migration SQL travels with the package and is applied
 * here.
 *
 * SCOPE: deliberately minimal, and deliberately compatible with Prisma's own
 * bookkeeping — it writes the same `_prisma_migrations` ledger that
 * `prisma migrate deploy` writes, so a developer who later points the CLI at
 * the same database does not see already-applied migrations as pending. It has
 * no `--create-only`, no drift detection, no rollback.
 *
 * OVERLAP WITH #335 — READ BEFORE MERGING EITHER.
 * #335 (PR #354) ships a real migration runner at `@prismalens/database/migrator`
 * and calls it from `packages/api/src/main.ts` before `NestFactory.create`. It is
 * NOT in this branch's base (`feat/236-jobstore-seam`), so this file could not
 * consume it — but the two DO duplicate once both land: the API would migrate
 * itself and `pl up` would migrate again first. The second run is a harmless
 * no-op (this is idempotent, and both write the same `_prisma_migrations`
 * ledger), so nothing breaks; it is still one runner too many.
 *
 * Resolution, whichever merges second: delete this file and the
 * `applyMigrations` call in `packages/cli/src/cli/up.ts`, and keep #335's runner.
 * `pl up` needs no migration code of its own once the API self-migrates. What
 * `pl up` DOES still need is the SQL in the tarball — a bundler inlines a
 * runner's JS but never copies its `.sql`, so `scripts/pack-cli.mjs` stages the
 * migration SQL at BOTH `prisma/<flavour>/schema` (what this file reads) and
 * `dist/prisma/<flavour>/schema` (what #335's runner reads) and asserts both.
 * That staging must survive the deletion.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the migration SQL lives, both in the repo and in the published
 * tarball: the compiled module sits at `<pkg>/dist/migrate.js`, the SQL at
 * `<pkg>/prisma/sqlite/schema/<timestamp>_<name>/migration.sql`.
 */
export function migrationsDir(): string {
	// Compiled: `<pkg>/dist/migrate.js` -> `<pkg>/prisma/...`.
	// Source (tsx, tests): `<pkg>/migrate.ts` -> `<pkg>/prisma/...`.
	// Both layouts are real, so try both rather than assuming the build.
	for (const base of [join(HERE, ".."), HERE]) {
		const candidate = join(base, "prisma", "sqlite", "schema");
		if (existsSync(candidate)) return candidate;
	}
	return join(HERE, "..", "prisma", "sqlite", "schema");
}

export interface MigrateResult {
	/** Migration directory names applied by this call, in order. */
	applied: string[];
	/** Migration directory names already present in the ledger. */
	alreadyApplied: string[];
}

interface MinimalDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		run(...params: unknown[]): unknown;
	};
	close(): unknown;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
	"id" TEXT PRIMARY KEY NOT NULL,
	"checksum" TEXT NOT NULL,
	"finished_at" DATETIME,
	"migration_name" TEXT NOT NULL,
	"logs" TEXT,
	"rolled_back_at" DATETIME,
	"started_at" DATETIME NOT NULL DEFAULT current_timestamp,
	"applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

/**
 * Apply every migration not yet recorded in `_prisma_migrations`.
 *
 * Idempotent: running it on an up-to-date database is a no-op. Safe to call on
 * every boot, which is exactly how `pl up` uses it.
 *
 * @param databaseFile Absolute path to the SQLite file. Created if missing.
 * @param dir Directory of migration folders. Defaults to the shipped one.
 */
export async function applyMigrations(
	databaseFile: string,
	dir: string = migrationsDir(),
): Promise<MigrateResult> {
	if (!existsSync(dir)) {
		throw new Error(
			`No migration SQL at ${dir}. The published package must carry ` +
				`prisma/sqlite/schema — see scripts/pack-cli.mjs.`,
		);
	}

	const migrations = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => existsSync(join(dir, name, "migration.sql")))
		.sort();

	if (migrations.length === 0) {
		throw new Error(`No migration folders under ${dir}`);
	}

	// Imported dynamically so this module can be loaded (for `migrationsDir()`)
	// without paying for the native binding.
	const { default: Database } = await import("better-sqlite3");
	const db = new Database(databaseFile) as unknown as MinimalDatabase;

	const result: MigrateResult = { applied: [], alreadyApplied: [] };
	try {
		db.exec("PRAGMA foreign_keys = ON");
		db.exec(LEDGER);

		const recorded = new Set(
			(
				db
					.prepare(
						`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
					)
					.all() as Array<{ migration_name: string }>
			).map((row) => row.migration_name),
		);

		for (const name of migrations) {
			if (recorded.has(name)) {
				result.alreadyApplied.push(name);
				continue;
			}
			const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
			const checksum = createHash("sha256").update(sql).digest("hex");
			db.exec("BEGIN");
			try {
				db.exec(sql);
				db.prepare(
					`INSERT INTO "_prisma_migrations"
						(id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
					 VALUES (?, ?, current_timestamp, ?, NULL, NULL, current_timestamp, 1)`,
				).run(randomUUID(), checksum, name);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw new Error(
					`Migration ${name} failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			result.applied.push(name);
		}
	} finally {
		db.close();
	}

	return result;
}
