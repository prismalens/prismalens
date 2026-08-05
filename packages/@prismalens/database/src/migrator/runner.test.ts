// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMigrationsDir } from "./migration-source.js";
import { defaultDatabaseFile, MigrationError, runMigrations } from "./runner.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH_ROOT = join(PACKAGE_DIR, ".tmp-migrator-tests");

/**
 * The one migration this repo ships, and the checksum a real
 * `prisma migrate deploy` recorded for it. Pinned so a change to the shipped
 * SQL is caught here rather than on a user's machine.
 */
const SHIPPED_INIT = "20260803122809_init";

/** Prisma's own `_prisma_migrations` DDL, as SQLite stores it in sqlite_master. */
const PRISMA_LEDGER_DDL = `CREATE TABLE "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

const BASE = "20260101000000_base";
const ADD_COLOUR = "20260102000000_add_colour";
const BROKEN = "20260103000000_broken";

const FIXTURE_SQL: Record<string, string> = {
	[BASE]: `-- CreateTable
CREATE TABLE "widget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);
`,
	[ADD_COLOUR]: `-- AlterTable
ALTER TABLE "widget" ADD COLUMN "colour" TEXT;
`,
	// A valid statement followed by an invalid one: proves the whole pass is
	// atomic, not just each statement.
	[BROKEN]: `CREATE TABLE "gadget" ("id" TEXT NOT NULL PRIMARY KEY);
THIS IS NOT SQL;
`,
};

let scratch: string;

/** Materialise a fixture migration lineage containing exactly `names`. */
function lineage(names: string[]): string {
	const dir = mkdtempSync(join(scratch, "migrations-"));
	for (const name of names) {
		mkdirSync(join(dir, name), { recursive: true });
		writeFileSync(join(dir, name, "migration.sql"), FIXTURE_SQL[name]);
	}
	return dir;
}

function dbFile(name = "prismalens.db"): string {
	return join(scratch, name);
}

interface LedgerRow {
	id: string;
	checksum: string;
	migration_name: string;
	finished_at: number | null;
	rolled_back_at: number | null;
	started_at: number;
	applied_steps_count: number;
}

function readLedger(file: string): LedgerRow[] {
	const db = new Database(file, { readonly: true });
	try {
		return db
			.prepare(
				`SELECT * FROM "_prisma_migrations" ORDER BY "migration_name"`,
			)
			.all() as LedgerRow[];
	} finally {
		db.close();
	}
}

function tableNames(file: string): string[] {
	const db = new Database(file, { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
				)
				.all() as { name: string }[]
		).map((r) => r.name);
	} finally {
		db.close();
	}
}

function sha256OfFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function backupsIn(dir: string): string[] {
	return readdirSync(dir).filter((f) => f.includes(".db.bak-"));
}

beforeEach(() => {
	mkdirSync(SCRATCH_ROOT, { recursive: true });
	scratch = mkdtempSync(join(SCRATCH_ROOT, "case-"));
});

afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe("runMigrations — fresh database", () => {
	it("creates the database and applies every shipped migration in order", async () => {
		const migrationsDir = lineage([BASE, ADD_COLOUR]);
		const file = dbFile();
		expect(existsSync(file)).toBe(false);

		const result = await runMigrations({ databaseFile: file, migrationsDir });

		expect(result.status).toBe("applied");
		expect(result.applied).toEqual([BASE, ADD_COLOUR]);
		expect(result.alreadyApplied).toEqual([]);
		expect(result.backupFile).toBeNull();

		expect(tableNames(file)).toContain("widget");
		const columns = new Database(file, { readonly: true });
		const cols = (
			columns.prepare(`PRAGMA table_info("widget")`).all() as { name: string }[]
		).map((c) => c.name);
		columns.close();
		expect(cols).toEqual(["id", "name", "colour"]);
	});

	it("records the ledger exactly the way Prisma does", async () => {
		const migrationsDir = lineage([BASE, ADD_COLOUR]);
		const file = dbFile();

		await runMigrations({ databaseFile: file, migrationsDir });

		const rows = readLedger(file);
		expect(rows.map((r) => r.migration_name)).toEqual([BASE, ADD_COLOUR]);
		for (const row of rows) {
			expect(row.checksum).toBe(
				sha256OfFile(join(migrationsDir, row.migration_name, "migration.sql")),
			);
			expect(row.finished_at).not.toBeNull();
			expect(row.rolled_back_at).toBeNull();
			expect(row.applied_steps_count).toBe(1);
			expect(row.started_at).toBeLessThanOrEqual(row.finished_at as number);
			expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
		}

		// Byte-identical to the table `prisma migrate deploy` creates, so a
		// database this runner bootstrapped stays legible to the Prisma CLI.
		const db = new Database(file, { readonly: true });
		const ddl = db
			.prepare(
				`SELECT sql FROM sqlite_master WHERE name = '_prisma_migrations'`,
			)
			.get() as { sql: string };
		db.close();
		expect(ddl.sql).toBe(PRISMA_LEDGER_DDL);
	});

	it("applies the migrations this repo actually ships", async () => {
		const file = dbFile();

		const result = await runMigrations({
			databaseFile: file,
			migrationsDir: resolveMigrationsDir("sqlite"),
		});

		expect(result.applied).toContain(SHIPPED_INIT);
		const rows = readLedger(file);
		expect(rows.map((r) => r.migration_name)).toContain(SHIPPED_INIT);
		// Tables from the real init migration are present.
		expect(tableNames(file)).toEqual(
			expect.arrayContaining(["services", "repositories"]),
		);
	});
});

describe("runMigrations — already current database", () => {
	it("is a no-op on the second run", async () => {
		const migrationsDir = lineage([BASE, ADD_COLOUR]);
		const file = dbFile();

		await runMigrations({ databaseFile: file, migrationsDir });
		const before = readLedger(file);

		const second = await runMigrations({ databaseFile: file, migrationsDir });

		expect(second.status).toBe("up-to-date");
		expect(second.applied).toEqual([]);
		expect(second.alreadyApplied).toEqual([BASE, ADD_COLOUR]);
		expect(second.backupFile).toBeNull();

		const after = readLedger(file);
		expect(after).toEqual(before);
		expect(backupsIn(scratch)).toEqual([]);
	});
});

describe("runMigrations — partially migrated database", () => {
	it("advances to current and preserves the data already there", async () => {
		const file = dbFile();
		const partial = lineage([BASE]);
		await runMigrations({ databaseFile: file, migrationsDir: partial });

		const seed = new Database(file);
		seed
			.prepare(`INSERT INTO "widget" ("id", "name") VALUES (?, ?)`)
			.run("w1", "spinner");
		seed.close();

		const full = lineage([BASE, ADD_COLOUR]);
		const result = await runMigrations({ databaseFile: file, migrationsDir: full });

		expect(result.status).toBe("applied");
		expect(result.applied).toEqual([ADD_COLOUR]);
		expect(result.alreadyApplied).toEqual([BASE]);

		const db = new Database(file, { readonly: true });
		const row = db
			.prepare(`SELECT "id", "name", "colour" FROM "widget"`)
			.get() as { id: string; name: string; colour: string | null };
		db.close();
		expect(row).toEqual({ id: "w1", name: "spinner", colour: null });

		expect(readLedger(file).map((r) => r.migration_name)).toEqual([
			BASE,
			ADD_COLOUR,
		]);
	});

	it("backs the database up before writing to it", async () => {
		const file = dbFile();
		await runMigrations({ databaseFile: file, migrationsDir: lineage([BASE]) });
		const seed = new Database(file);
		seed
			.prepare(`INSERT INTO "widget" ("id", "name") VALUES (?, ?)`)
			.run("w1", "spinner");
		seed.close();

		const result = await runMigrations({
			databaseFile: file,
			migrationsDir: lineage([BASE, ADD_COLOUR]),
		});

		expect(result.backupFile).not.toBeNull();
		expect(existsSync(result.backupFile as string)).toBe(true);
		// The backup is the PRE-migration state: it has no `colour` column.
		const backup = new Database(result.backupFile as string, { readonly: true });
		const cols = (
			backup.prepare(`PRAGMA table_info("widget")`).all() as { name: string }[]
		).map((c) => c.name);
		const preserved = backup
			.prepare(`SELECT "name" FROM "widget"`)
			.get() as { name: string };
		backup.close();
		expect(cols).toEqual(["id", "name"]);
		expect(preserved.name).toBe("spinner");
	});
});

describe("runMigrations — refuses incompatible histories", () => {
	it("hard-stops on version skew rather than partially applying", async () => {
		const file = dbFile();
		await runMigrations({
			databaseFile: file,
			migrationsDir: lineage([BASE, ADD_COLOUR]),
		});
		const before = readLedger(file);

		// An older build: it ships BASE only, but the database records more.
		await expect(
			runMigrations({ databaseFile: file, migrationsDir: lineage([BASE]) }),
		).rejects.toMatchObject({
			name: "MigrationError",
			code: "version-skew",
		});

		expect(readLedger(file)).toEqual(before);
		expect(backupsIn(scratch)).toEqual([]);
	});

	it("hard-stops when a shipped migration's SQL no longer matches what was applied", async () => {
		const file = dbFile();
		const migrationsDir = lineage([BASE]);
		await runMigrations({ databaseFile: file, migrationsDir });
		const before = readLedger(file);

		// A squashed / edited history — the exact thing the retired dev-phase
		// rule used to produce.
		writeFileSync(
			join(migrationsDir, BASE, "migration.sql"),
			`${FIXTURE_SQL[BASE]}-- edited\n`,
		);

		await expect(
			runMigrations({ databaseFile: file, migrationsDir }),
		).rejects.toMatchObject({
			name: "MigrationError",
			code: "checksum-mismatch",
		});
		expect(readLedger(file)).toEqual(before);
	});

	it("hard-stops when a previous run left a migration unfinished", async () => {
		const file = dbFile();
		const migrationsDir = lineage([BASE, ADD_COLOUR]);
		await runMigrations({ databaseFile: file, migrationsDir: lineage([BASE]) });

		const db = new Database(file);
		db.prepare(
			`INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") VALUES (?, ?, NULL, ?, NULL, NULL, ?, 0)`,
		).run("stuck", sha256OfFile(join(migrationsDir, ADD_COLOUR, "migration.sql")), ADD_COLOUR, Date.now());
		db.close();

		await expect(
			runMigrations({ databaseFile: file, migrationsDir }),
		).rejects.toMatchObject({
			name: "MigrationError",
			code: "incomplete-migration",
		});
	});

	it("rolls the whole pass back when a migration fails mid-script", async () => {
		const file = dbFile();
		await runMigrations({ databaseFile: file, migrationsDir: lineage([BASE]) });
		const before = readLedger(file);

		await expect(
			runMigrations({
				databaseFile: file,
				migrationsDir: lineage([BASE, ADD_COLOUR, BROKEN]),
			}),
		).rejects.toThrow();

		// Neither the good migration that ran before the bad one, nor the bad
		// migration's first (valid) statement, survives.
		expect(readLedger(file)).toEqual(before);
		expect(tableNames(file)).not.toContain("gadget");
		const db = new Database(file, { readonly: true });
		const cols = (
			db.prepare(`PRAGMA table_info("widget")`).all() as { name: string }[]
		).map((c) => c.name);
		db.close();
		expect(cols).toEqual(["id", "name"]);
	});

	it("throws when the build ships no migrations at all", async () => {
		await expect(
			runMigrations({ databaseFile: dbFile(), migrationsDir: lineage([]) }),
		).rejects.toMatchObject({ code: "no-migrations" });
	});
});

describe("runMigrations — concurrency", () => {
	it("lets exactly one of two concurrent runs apply, and the other no-ops", async () => {
		const migrationsDir = lineage([BASE, ADD_COLOUR]);
		const file = dbFile();

		// busyTimeoutMs 0 makes the loser fail fast instead of blocking this
		// single-threaded test; it then retries into the post-commit no-op.
		const log: string[] = [];
		const [a, b] = await Promise.all([
			runMigrations({
				databaseFile: file,
				migrationsDir,
				busyTimeoutMs: 0,
				log: (m) => log.push(m),
			}),
			runMigrations({
				databaseFile: file,
				migrationsDir,
				busyTimeoutMs: 0,
				log: (m) => log.push(m),
			}),
		]);

		const applied = [a, b].filter((r) => r.status === "applied");
		expect(applied).toHaveLength(1);
		expect(applied[0].applied).toEqual([BASE, ADD_COLOUR]);

		// The loser must have lost the write lock and re-read the ledger while
		// holding it — not merely arrived after the winner had finished. Without
		// this the test would still pass if the runs never actually overlapped.
		expect(log).toContain(
			"Another process applied the pending migrations first; nothing to do.",
		);

		// One ledger row per migration — no duplicates from the losing run.
		expect(readLedger(file).map((r) => r.migration_name)).toEqual([
			BASE,
			ADD_COLOUR,
		]);
	});
});

describe("runMigrations — default database location", () => {
	it("resolves the app-data file from PRISMALENS_WORKSPACE_DIR, never the home directory", async () => {
		const previous = process.env.PRISMALENS_WORKSPACE_DIR;
		process.env.PRISMALENS_WORKSPACE_DIR = join(scratch, "workspace");
		try {
			expect(defaultDatabaseFile()).toBe(
				join(scratch, "workspace", "prismalens.db"),
			);

			// No `databaseFile` passed: the default has to land inside the
			// workspace override, not in ~/.prismalens.
			const result = await runMigrations({
				migrationsDir: lineage([BASE]),
			});

			expect(result.databaseFile).toBe(
				join(scratch, "workspace", "prismalens.db"),
			);
			expect(existsSync(result.databaseFile)).toBe(true);
		} finally {
			if (previous === undefined) delete process.env.PRISMALENS_WORKSPACE_DIR;
			else process.env.PRISMALENS_WORKSPACE_DIR = previous;
		}
	});
});

describe("runMigrations — non-SQLite placements", () => {
	it("skips without touching anything when the database type is postgresql", async () => {
		const file = dbFile();

		const result = await runMigrations({
			databaseFile: file,
			dbType: "postgresql",
		});

		expect(result.status).toBe("skipped-non-sqlite");
		expect(result.applied).toEqual([]);
		expect(existsSync(file)).toBe(false);
	});
});
