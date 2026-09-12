// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Locates and reads the SQLite migration SQL shipped inside the package
// (no pnpm/prisma CLI on an end user's machine). See #597.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ShippedMigration {
	/** Directory name, e.g. `20260803122809_init`. Prisma's migration identity. */
	readonly name: string;
	/** Absolute path to the `migration.sql` file. */
	readonly path: string;
	/** File contents, executed verbatim. */
	readonly sql: string;
	/**
	 * sha256 hex of the raw `migration.sql` bytes — byte-for-byte the algorithm
	 * Prisma records in `_prisma_migrations.checksum`, verified against a real
	 * `prisma migrate deploy` run.
	 */
	readonly checksum: string;
}

const MIGRATION_FILE = "migration.sql";
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Escape hatch for hosts that relocate the SQL (a bundler flattening the
 * package, a container image staging it elsewhere) and for tests that point the
 * runner at a fixture lineage.
 */
export const MIGRATIONS_DIR_ENV = "PRISMALENS_MIGRATIONS_DIR";

/**
 * Every place the migration directory may sit, most-specific first. Ordered so
 * a packed install (`dist/prisma/…`) wins over the workspace source tree; the
 * later entries only matter when a bundler has emitted this module at a
 * different depth than `tsc` does.
 */
export function migrationDirCandidates(): string[] {
	const suffix = join("prisma", "sqlite", "schema");
	return [
		resolve(HERE, "..", "..", suffix),
		resolve(HERE, "..", "..", "..", suffix),
		resolve(HERE, "..", suffix),
	];
}

/**
 * Resolve the directory holding the shipped migrations.
 *
 * @param override - explicit directory; wins over the env var and the search
 * @returns absolute path to a directory that exists
 * @throws Error naming every path tried, when none exists
 */
export function resolveMigrationsDir(override?: string): string {
	const explicit = override ?? process.env[MIGRATIONS_DIR_ENV];
	if (explicit) {
		const abs = resolve(explicit);
		if (!existsSync(abs)) {
			throw new Error(
				`Migrations directory not found at ${abs} (from ${override ? "the migrationsDir option" : MIGRATIONS_DIR_ENV}).`,
			);
		}
		return abs;
	}

	const candidates = migrationDirCandidates();
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	throw new Error(
		`Could not locate the shipped SQLite migrations. Looked in:\n` +
			candidates.map((c) => `  - ${c}`).join("\n") +
			`\nSet ${MIGRATIONS_DIR_ENV} to the directory holding the <timestamp>_<name>/migration.sql folders.`,
	);
}

/**
 * Read every migration in a lineage, in the order Prisma applies them.
 *
 * Directory names are timestamp-prefixed, so a lexicographic sort is the
 * chronological one — the same ordering `prisma migrate deploy` uses.
 *
 * @param dir - directory holding `<timestamp>_<name>/migration.sql` folders
 * @returns migrations in application order (empty when the lineage is empty)
 */
export function readShippedMigrations(dir: string): ShippedMigration[] {
	const names = readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort();

	const migrations: ShippedMigration[] = [];
	for (const name of names) {
		const path = join(dir, name, MIGRATION_FILE);
		// A migration directory with no SQL means the artifact is mis-packaged.
		// Skipping it silently would under-migrate the database and then report
		// success — exactly the failure this runner exists to make impossible.
		if (!existsSync(path)) {
			throw new Error(
				`Migration "${name}" is missing ${MIGRATION_FILE} (expected at ${path}). The shipped migrations are incomplete.`,
			);
		}
		const bytes = readFileSync(path);
		migrations.push({
			name,
			path,
			sql: bytes.toString("utf8"),
			checksum: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	return migrations;
}
