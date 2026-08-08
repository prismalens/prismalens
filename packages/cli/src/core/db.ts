// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

let DatabaseSync: typeof DatabaseSyncType;

try {
	const mod = await import("node:sqlite");
	DatabaseSync = mod.DatabaseSync;
} catch {
	console.error("PrismaLens requires Node >= 22.13.");
	process.exit(1);
}

/**
 * The CLI's session store. Deliberately NOT `prismalens.db` — that filename
 * belongs to the Prisma-managed application database (`@prismalens/config`
 * hands Prisma `<app data dir>/prismalens.db`). The two stores shared one file
 * until #355; the recovery path below renames its file aside on schema drift,
 * which on a shared file carried the user's incidents away with it.
 */
export const CLI_DB_FILENAME = "prismalens-cli.db";

/** The file the CLI used to share with the app, pre-#355. Never opened for writing. */
const LEGACY_SHARED_DB_FILENAME = "prismalens.db";

/**
 * Every table the CLI session store owns. Anything else in the file means the
 * file is not a CLI session store, and must not be renamed aside.
 */
const KNOWN_TABLES = new Set([
	"groups",
	"runs",
	"events",
	"reports",
	"group_alerts",
]);

const SCHEMA = `
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS groups (
			id         TEXT PRIMARY KEY,
			group_key  TEXT,
			formed_by  TEXT NOT NULL DEFAULT 'window',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS runs (
			run_id         TEXT PRIMARY KEY,
			group_id       TEXT REFERENCES groups(id),
			status         TEXT NOT NULL CHECK (status IN ('running','done','errored','suppressed')),
			alertname      TEXT,
			agent          TEXT,
			repo           TEXT,
			workspace_path TEXT NOT NULL,
			error          TEXT,
			suppression_reason TEXT,
			origin         TEXT NOT NULL DEFAULT 'local',
			schema_version INTEGER NOT NULL DEFAULT 1,
			created_at     TEXT NOT NULL,
			updated_at     TEXT NOT NULL,
			completed_at   TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_runs_status     ON runs(status);

		CREATE TABLE IF NOT EXISTS events (
			id      INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id  TEXT NOT NULL REFERENCES runs(run_id),
			payload TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);

		CREATE TABLE IF NOT EXISTS reports (
			run_id  TEXT PRIMARY KEY REFERENCES runs(run_id),
			payload TEXT NOT NULL
		);

		-- One row per alert attached to a group, in insertion order (rowid).
		-- late = 0 for the alerts that formed the window, 1 for alerts that
		-- attached while the group's run was already in flight.
		CREATE TABLE IF NOT EXISTS group_alerts (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			group_id TEXT NOT NULL REFERENCES groups(id),
			late     INTEGER NOT NULL,
			payload  TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_group_alerts ON group_alerts(group_id, id);
`;

const SCHEMA_CHECK = `
		SELECT id, group_key, formed_by, created_at FROM groups LIMIT 1;
		SELECT run_id, group_id, status, alertname, agent, repo, workspace_path, error, suppression_reason, origin, schema_version, created_at, updated_at, completed_at FROM runs LIMIT 1;
		SELECT id, run_id, payload FROM events LIMIT 1;
		SELECT run_id, payload FROM reports LIMIT 1;
		SELECT id, group_id, late, payload FROM group_alerts LIMIT 1;
`;

// Columns added after a release ship as in-place ALTERs: replacing the
// database would orphan the user's run history, which schema_version exists
// to protect (ADR-0026). SQLite backfills existing rows from the DEFAULT.
const ADDITIVE_MIGRATIONS = [
	`ALTER TABLE runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'`,
	`ALTER TABLE runs ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`,
];

/**
 * Refuse to operate on a file the CLI does not own. The recovery path below
 * renames the whole file aside; on a database holding Prisma's tables that
 * rename is silent loss of the user's incidents. Any table outside the CLI's
 * own five means this is not a CLI session store — say so, loudly, and stop
 * before touching anything. (#355)
 */
function assertCliOwnedFile(db: DatabaseSyncType, dbPath: string): void {
	const tables = db
		.prepare(
			`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
		)
		.all() as { name: string }[];
	const foreign = tables.map((t) => t.name).filter((n) => !KNOWN_TABLES.has(n));
	if (foreign.length === 0) return;

	try {
		db.close();
	} catch {}
	throw new Error(
		`Refusing to use ${dbPath}: it contains application data.\n` +
			`The file holds tables the PrismaLens CLI does not own (${foreign.join(", ")}) — this is the PrismaLens application database, not a CLI session store. ` +
			`Backing it up and recreating it, as the CLI does when its own store drifts, would take your incidents, investigations, services and postmortems with it.\n` +
			`Safe action: leave ${dbPath} exactly where it is and point the CLI at a different workspace (\`--workspace <dir>\`, or PRISMALENS_WORKSPACE_DIR=<dir>). The CLI keeps its own store in ${CLI_DB_FILENAME}, alongside the app database, never inside it. ` +
			`Move this file aside yourself only if you are certain it is a disposable CLI store.`,
	);
}

/**
 * Pre-#355 the CLI wrote its run history into the shared `prismalens.db`. That
 * history is NOT migrated into the new store: on a shared file the CLI's
 * `events` table and Prisma's `events` table are the same name, so a copy
 * cannot tell whose rows it is reading. The old rows are left untouched and
 * inert — but the operator is told, once, rather than silently starting empty.
 */
function reportLegacyRunHistory(baseDir: string, db: DatabaseSyncType): void {
	try {
		const legacyPath = join(baseDir, LEGACY_SHARED_DB_FILENAME);
		if (!existsSync(legacyPath)) return;

		// Only speak up while the new store is still empty — once the CLI has
		// recorded a run of its own, the notice has served its purpose.
		const { n: migrated } = db
			.prepare("SELECT COUNT(*) AS n FROM runs")
			.get() as {
			n: number;
		};
		if (migrated > 0) return;

		const legacy = new DatabaseSync(legacyPath, { readOnly: true });
		try {
			// `runs` is unambiguous: the CLI owns it and the Prisma schema has no
			// table by that name, so its presence means old CLI history.
			const hasRuns = legacy
				.prepare(
					`SELECT name FROM sqlite_master WHERE type='table' AND name='runs'`,
				)
				.get();
			if (!hasRuns) return;
			const { n } = legacy.prepare("SELECT COUNT(*) AS n FROM runs").get() as {
				n: number;
			};
			if (n === 0) return;
			console.warn(
				`[!] ${n} earlier run(s) live in ${legacyPath}, which previous versions of the CLI shared with the PrismaLens application database.\n` +
					`    The CLI now keeps its own store at ${join(baseDir, CLI_DB_FILENAME)} and starts empty — that history was NOT copied across, and ${legacyPath} was not modified.\n` +
					`    Nothing in the app reads those rows; if you do not need the old run history, no action is required.`,
			);
		} finally {
			legacy.close();
		}
	} catch {
		// Advisory only — never let the notice break opening the store.
	}
}

export function openDatabase(baseDir: string): DatabaseSyncType {
	mkdirSync(baseDir, { recursive: true });
	const db = openStore(baseDir, join(baseDir, CLI_DB_FILENAME));
	reportLegacyRunHistory(baseDir, db);
	return db;
}

function openStore(baseDir: string, dbPath: string): DatabaseSyncType {
	let db = new DatabaseSync(dbPath);

	// Checked before the first write, not only before the rename: if this file
	// is not ours, the CLI should not be creating its tables inside it either.
	assertCliOwnedFile(db, dbPath);

	try {
		db.exec(SCHEMA);
		db.exec(SCHEMA_CHECK);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!/no such column|no such table|has no column named/i.test(msg)) {
			try {
				db.close();
			} catch {}
			throw err;
		}

		// Additive migration first — only if it cannot make the schema whole
		// does the backup-and-recreate path below run.
		try {
			for (const stmt of ADDITIVE_MIGRATIONS) {
				try {
					db.exec(stmt);
				} catch (migErr: unknown) {
					const m = migErr instanceof Error ? migErr.message : String(migErr);
					if (!/duplicate column name/i.test(m)) throw migErr;
				}
			}
			db.exec(SCHEMA);
			db.exec(SCHEMA_CHECK);
			return db;
		} catch {
			// Fall through to backup-and-recreate.
		}

		// Second gate, immediately before the rename: the guard must hold even if
		// a foreign table appeared after the open-time check, and this is the
		// exact line that would otherwise carry the user's data away.
		assertCliOwnedFile(db, dbPath);

		// Schema mismatch or corruption detected.
		const backupPath = join(baseDir, `${CLI_DB_FILENAME}.bak-${Date.now()}`);
		if (existsSync(`${dbPath}-wal`))
			renameSync(`${dbPath}-wal`, `${backupPath}-wal`);
		if (existsSync(`${dbPath}-shm`))
			renameSync(`${dbPath}-shm`, `${backupPath}-shm`);
		db.close();
		renameSync(dbPath, backupPath);
		console.warn(
			`[!] Workspace schema is incompatible. Backed up old database to ${backupPath} and recreated.`,
		);

		// Recreate a fresh database.
		db = new DatabaseSync(dbPath);
		db.exec(SCHEMA);
	}

	return db;
}
