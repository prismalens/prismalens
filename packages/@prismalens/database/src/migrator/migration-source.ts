// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Locating and reading the migration SQL that ships INSIDE the package.
 *
 * `pl up` runs on an end user's machine: there is no `pnpm`, no `prisma` CLI,
 * and no schema source there. The only thing the runner can rely on is the
 * migration SQL that was packed next to the compiled JavaScript, so every path
 * here is resolved relative to this module's own location rather than to a
 * workspace root or `process.cwd()`.
 *
 * The package's `tsc` config uses `rootDir: "."`, so `dist/` mirrors the
 * package root. That gives one relative path that is correct in both places:
 *
 *   source (tsx)   <pkg>/src/migrator/…      → ../.. → <pkg>/prisma/<flavour>/schema
 *   built / packed <pkg>/dist/src/migrator/… → ../.. → <pkg>/dist/prisma/<flavour>/schema
 *
 * `scripts/copy-migrations.mjs` is what puts the SQL under `dist/prisma` at
 * build time; `tsc` alone would leave the `.sql` files behind.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Which migration lineage to read — one directory per Prisma datasource. */
export type MigrationFlavour = "sqlite" | "pg";

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
export function migrationDirCandidates(flavour: MigrationFlavour): string[] {
	const suffix = join("prisma", flavour, "schema");
	return [
		resolve(HERE, "..", "..", suffix),
		resolve(HERE, "..", "..", "..", suffix),
		resolve(HERE, "..", suffix),
	];
}

/**
 * Resolve the directory holding the shipped migrations.
 *
 * @param flavour - datasource lineage to read
 * @param override - explicit directory; wins over the env var and the search
 * @returns absolute path to a directory that exists
 * @throws Error naming every path tried, when none exists
 */
export function resolveMigrationsDir(
	flavour: MigrationFlavour,
	override?: string,
): string {
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

	const candidates = migrationDirCandidates(flavour);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	throw new Error(
		`Could not locate the shipped ${flavour} migrations. Looked in:\n` +
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
		if (!existsSync(path)) continue;
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
