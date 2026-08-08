// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shipped SQLite migration runner.
 *
 * Applies pending Prisma migrations to the app-data database **programmatically**
 * — no `prisma` binary, no `pnpm`, no schema source. Everything it needs travels
 * inside the package (see `migration-source.ts`), because from R1 onward the only
 * place this code runs is an end user's machine after `npm i -g prismalens`.
 *
 * It writes `_prisma_migrations` exactly the way Prisma does (identical DDL,
 * identical sha256 checksum algorithm, `applied_steps_count = 1`), so a database
 * this runner advanced stays legible to `prisma migrate status`/`deploy` for
 * anyone debugging with the CLI in hand.
 *
 * ## Safety story
 *
 * - **Idempotent.** `_prisma_migrations` is the ledger. Pending = shipped minus
 *   recorded. A second run finds nothing pending and returns `up-to-date`.
 * - **Concurrency-safe.** The whole apply pass runs inside one
 *   `BEGIN IMMEDIATE` transaction on a dedicated connection, and the ledger is
 *   re-read *after* the write lock is held. A second process either waits out
 *   `busy_timeout` and then finds nothing pending, or loses the `BEGIN` and
 *   retries into the same no-op. SQLite DDL is transactional, so a crash
 *   mid-apply rolls the schema **and** the ledger row back together — there is
 *   no partially-applied state to clean up.
 * - **Backed up before any write.** An existing, already-populated database is
 *   copied via SQLite's online-backup API — taken *after* the write lock is held
 *   and *before* the first DDL, so the copy describes exactly the state the
 *   migration runs against.
 * - **Never applies over an unknown history.** A database recording a migration
 *   this build does not ship (version skew), a shipped migration whose checksum
 *   no longer matches what was applied (a squashed/edited history), or a
 *   recorded set that is not an ordered prefix of the shipped one (a gap or a
 *   duplicate) is a hard stop with instructions — never a partial apply.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAppDataDir } from "@prismalens/config";
import Database from "better-sqlite3";
import {
	type MigrationFlavour,
	readShippedMigrations,
	resolveMigrationsDir,
	type ShippedMigration,
} from "./migration-source.js";

const MIGRATIONS_TABLE = "_prisma_migrations";

/**
 * Verbatim copy of the columns Prisma's migration engine creates for SQLite,
 * captured from a real `prisma migrate deploy` run on this repo's schema. Kept
 * byte-identical on purpose: a database bootstrapped by this runner and one
 * bootstrapped by the Prisma CLI must be indistinguishable. (SQLite strips
 * `IF NOT EXISTS` before storing the statement in `sqlite_master`, so adding it
 * below costs nothing.)
 */
const PRISMA_MIGRATIONS_COLUMNS = `(
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

/** `CREATE TABLE "_prisma_migrations" (…)` as Prisma emits it, minus the race. */
export const CREATE_MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ${PRISMA_MIGRATIONS_COLUMNS}`;
const DEFAULT_BUSY_TIMEOUT_MS = 30_000;
const LOCK_ATTEMPTS = 5;
const LOCK_RETRY_DELAY_MS = 250;

/** Why a migration run refused to proceed. Stable strings — logged and asserted on. */
export type MigrationErrorCode =
	/** The database records migrations this build does not ship. */
	| "version-skew"
	/** A recorded migration's SQL no longer matches what was applied. */
	| "checksum-mismatch"
	/** A previous run left a migration started-but-unfinished. */
	| "incomplete-migration"
	/** The recorded migrations are not an ordered prefix of the shipped ones. */
	| "history-gap"
	/** No migration SQL shipped with this build. */
	| "no-migrations"
	/** Another process held the write lock for the whole retry budget. */
	| "locked";

export class MigrationError extends Error {
	readonly code: MigrationErrorCode;

	constructor(code: MigrationErrorCode, message: string) {
		super(message);
		this.name = "MigrationError";
		this.code = code;
	}
}

export interface RunMigrationsOptions {
	/**
	 * SQLite file to migrate. Defaults to `<app data dir>/prismalens.db`, which
	 * honours `PRISMALENS_WORKSPACE_DIR`.
	 */
	databaseFile?: string;
	/** Directory holding the `<timestamp>_<name>/migration.sql` folders. */
	migrationsDir?: string;
	/** Datasource lineage to read. Defaults to `sqlite`. */
	flavour?: MigrationFlavour;
	/**
	 * Configured database type. Anything other than `sqlite` short-circuits: the
	 * Postgres placement is a server deploy with the Prisma CLI available, and
	 * migrating it from inside the app process is not this runner's job.
	 * Defaults to `PRISMALENS_DB_TYPE`.
	 */
	dbType?: string;
	/** How long to wait on a competing writer before giving up. */
	busyTimeoutMs?: number;
	/** Progress sink. Defaults to silence. */
	log?: (message: string) => void;
}

export interface MigrationRunResult {
	/** `applied` when this run changed the schema; `up-to-date` when it did not. */
	status: "applied" | "up-to-date" | "skipped-non-sqlite";
	databaseFile: string;
	/** `null` only when the run was skipped before resolving anything. */
	migrationsDir: string | null;
	/** Migrations this run applied, in order. */
	applied: string[];
	/** Migrations already recorded before this run. */
	alreadyApplied: string[];
	/** Path of the pre-migration backup, when one was taken. */
	backupFile: string | null;
}

interface AppliedMigrationRow {
	migration_name: string;
	checksum: string;
	finished_at: number | null;
	rolled_back_at: number | null;
}

type SqliteDatabase = Database.Database;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** Default location of the app-data SQLite file. */
export function defaultDatabaseFile(): string {
	return join(getAppDataDir(), "prismalens.db");
}

function migrationsTableExists(db: SqliteDatabase): boolean {
	const row = db
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
		.get(MIGRATIONS_TABLE);
	return row !== undefined;
}

function readLedger(db: SqliteDatabase): AppliedMigrationRow[] {
	if (!migrationsTableExists(db)) return [];
	return db
		.prepare(
			`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "${MIGRATIONS_TABLE}"`,
		)
		.all() as AppliedMigrationRow[];
}

/**
 * Refuse to touch a database whose history this build cannot account for.
 * Runs before any write, so a rejected database is left exactly as found.
 */
function assertHistoryIsCompatible(
	ledger: AppliedMigrationRow[],
	shipped: ShippedMigration[],
	databaseFile: string,
): void {
	const shippedByName = new Map(shipped.map((m) => [m.name, m]));

	const incomplete = ledger.filter(
		(row) => row.finished_at === null && row.rolled_back_at === null,
	);
	if (incomplete.length > 0) {
		throw new MigrationError(
			"incomplete-migration",
			`The database at ${databaseFile} has migrations that were started but never finished: ` +
				`${incomplete.map((r) => r.migration_name).join(", ")}. ` +
				`Nothing was applied. Restore the most recent ${databaseFile}.bak-* file, or resolve the migration with the Prisma CLI.`,
		);
	}

	const settled = ledger.filter((row) => row.rolled_back_at === null);

	const unknown = settled
		.map((row) => row.migration_name)
		.filter((name) => !shippedByName.has(name))
		.sort();
	if (unknown.length > 0) {
		throw new MigrationError(
			"version-skew",
			`The database at ${databaseFile} was written by a newer PrismaLens: it records ` +
				`${unknown.length === 1 ? "a migration" : "migrations"} this build does not ship (${unknown.join(", ")}). ` +
				`Nothing was applied. Upgrade PrismaLens (\`npm install -g prismalens@latest\`), or point PRISMALENS_WORKSPACE_DIR at a different directory to start fresh.`,
		);
	}

	const drifted = settled
		.filter(
			(row) => shippedByName.get(row.migration_name)?.checksum !== row.checksum,
		)
		.sort((a, b) => a.migration_name.localeCompare(b.migration_name));
	if (drifted.length > 0) {
		// Say what to DO, not just what is wrong. The naive reading of "drift" is
		// "delete the database and start over", and on this product that means
		// throwing away an operator's incident and investigation history. Deletion
		// is never the first resort: the ledger is repairable in place, so the
		// message names that path and shows the exact checksums needed to take it.
		const detail = drifted
			.map(
				(row) =>
					`  ${row.migration_name}\n` +
					`    recorded in the database: ${row.checksum}\n` +
					`    shipped by this build:    ${shippedByName.get(row.migration_name)?.checksum}`,
			)
			.join("\n");
		throw new MigrationError(
			"checksum-mismatch",
			`The migration SQL shipped with this build differs from what was applied to ${databaseFile}. ` +
				`Nothing was applied — the database is exactly as it was.\n\n${detail}\n\n` +
				`Migration history is append-only, so this means a shipped migration was edited after it had ` +
				`already been applied somewhere. DO NOT delete the database; it still holds your data.\n\n` +
				`To recover:\n` +
				`  1. If you are a contributor who edited the migration, restore the original SQL — that is the fix.\n` +
				`  2. Otherwise the edit shipped in a release. Your schema may be missing whatever the edit added, ` +
				`so compare it against a fresh database (\`PRISMALENS_WORKSPACE_DIR=$(mktemp -d) pl up\`), apply the ` +
				`missing DDL, and re-point the ledger — in ONE transaction:\n` +
				drifted
					.map(
						(row) =>
							`       UPDATE "${MIGRATIONS_TABLE}" SET checksum = '${shippedByName.get(row.migration_name)?.checksum}' WHERE migration_name = '${row.migration_name}';`,
					)
					.join("\n") +
				`\n     Re-pointing the ledger WITHOUT applying the missing DDL will silence this error and leave ` +
				`the schema broken — the runner trusts the ledger.\n` +
				`  3. If you would rather start clean, keep the old file and point PRISMALENS_WORKSPACE_DIR somewhere new.`,
		);
	}

	// History is append-only, so what was applied must be an ordered PREFIX of
	// what ships. Anything else — a duplicate row, or a later migration recorded
	// without its predecessor — would make the runner apply an older migration
	// on top of a newer one. Refuse instead.
	const appliedNames = settled.map((row) => row.migration_name).sort();
	const expectedPrefix = shipped
		.slice(0, appliedNames.length)
		.map((m) => m.name);
	if (appliedNames.join(" ") !== expectedPrefix.join(" ")) {
		throw new MigrationError(
			"history-gap",
			`The migrations recorded in ${databaseFile} are not an ordered prefix of the migrations this build ships: ` +
				`recorded [${appliedNames.join(", ")}], expected [${expectedPrefix.join(", ")}]. ` +
				`Nothing was applied. A gap or a duplicate row means the history was edited outside this runner; ` +
				`restore the most recent ${databaseFile}.bak-* file, or reconcile with the Prisma CLI.`,
		);
	}
}

/**
 * Copy the database with SQLite's online-backup API. A plain file copy is not
 * safe here: any `-wal` content would be left behind.
 *
 * Reads through a SEPARATE read-only connection, because the caller takes the
 * backup while the migration connection already holds the write lock — that
 * ordering is what makes the backup match the state the migration will run
 * against. Readers are still admitted under a RESERVED lock, and no DDL has run
 * yet, so what this copies is the last committed state.
 */
async function backupDatabase(databaseFile: string): Promise<string> {
	const backupFile = `${databaseFile}.bak-${Date.now()}`;
	const source = new Database(databaseFile, { readonly: true });
	try {
		await source.backup(backupFile);
	} finally {
		source.close();
	}
	return backupFile;
}

/** Take the write lock, retrying while another process holds it. */
async function beginImmediate(
	db: SqliteDatabase,
	databaseFile: string,
): Promise<void> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt++) {
		try {
			db.exec("BEGIN IMMEDIATE");
			return;
		} catch (error) {
			lastError = error;
			const code = (error as { code?: string }).code ?? "";
			if (!code.startsWith("SQLITE_BUSY")) throw error;
			if (attempt < LOCK_ATTEMPTS) await sleep(LOCK_RETRY_DELAY_MS * attempt);
		}
	}
	throw new MigrationError(
		"locked",
		`Could not acquire the write lock on ${databaseFile} — another PrismaLens process is migrating it. ` +
			`Nothing was applied. Wait for it to finish and retry. (${String(lastError)})`,
	);
}

function recordApplied(
	db: SqliteDatabase,
	migration: ShippedMigration,
	startedAt: number,
): void {
	db.prepare(
		`INSERT INTO "${MIGRATIONS_TABLE}" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
	).run(
		randomUUID(),
		migration.checksum,
		Date.now(),
		migration.name,
		startedAt,
	);
}

/**
 * Apply every pending migration to the app-data SQLite database.
 *
 * Safe to call on every app start: a current database is a read-only no-op.
 *
 * @param options - see {@link RunMigrationsOptions}; every field has a default
 * @returns what the run found and what it changed
 * @throws {MigrationError} when the database's history is incompatible with
 * this build, or when another process holds the write lock for too long. In
 * every such case nothing has been written.
 *
 * @example
 * ```ts
 * const result = await runMigrations({ log: (m) => logger.info(m) });
 * // { status: "applied", applied: ["20260803122809_init"], ... }
 * ```
 */
export async function runMigrations(
	options: RunMigrationsOptions = {},
): Promise<MigrationRunResult> {
	const log = options.log ?? (() => {});
	const dbType = options.dbType ?? process.env.PRISMALENS_DB_TYPE ?? "sqlite";
	const databaseFile = options.databaseFile ?? defaultDatabaseFile();

	if (dbType !== "sqlite") {
		log(
			`Skipping the embedded migration runner: PRISMALENS_DB_TYPE is "${dbType}". Server placements migrate with the Prisma CLI.`,
		);
		return {
			status: "skipped-non-sqlite",
			databaseFile,
			migrationsDir: null,
			applied: [],
			alreadyApplied: [],
			backupFile: null,
		};
	}

	const flavour = options.flavour ?? "sqlite";
	const migrationsDir = resolveMigrationsDir(flavour, options.migrationsDir);
	const shipped = readShippedMigrations(migrationsDir);
	if (shipped.length === 0) {
		throw new MigrationError(
			"no-migrations",
			`No migrations shipped at ${migrationsDir}. This build cannot create or advance a database.`,
		);
	}

	mkdirSync(dirname(databaseFile), { recursive: true });
	const db = new Database(databaseFile);

	try {
		db.pragma(
			`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`,
		);
		// Prisma's SQLite migrations assume foreign keys are not enforced while a
		// table is being redefined. This is a dedicated connection, closed below,
		// so the app's own connection is unaffected.
		db.pragma("foreign_keys = OFF");

		// --- read-only reconnaissance: no writes before the backup decision ---
		const ledger = readLedger(db);
		assertHistoryIsCompatible(ledger, shipped, databaseFile);

		const alreadyApplied = ledger
			.filter((row) => row.rolled_back_at === null)
			.map((row) => row.migration_name);
		const appliedSet = new Set(alreadyApplied);
		const pending = shipped.filter((m) => !appliedSet.has(m.name));

		if (pending.length === 0) {
			log(
				`Database is up to date (${alreadyApplied.length} migration(s) applied).`,
			);
			return {
				status: "up-to-date",
				databaseFile,
				migrationsDir,
				applied: [],
				alreadyApplied,
				backupFile: null,
			};
		}

		// Take the write lock BEFORE the backup. A competing writer that commits
		// between the two would otherwise be silently discarded if the backup were
		// ever restored — the backup has to describe the state the migration
		// actually runs against.
		await beginImmediate(db, databaseFile);
		let backupFile: string | null = null;
		const applied: string[] = [];
		try {
			// Re-read the ledger now that the write lock is held: a competing
			// process may have applied everything between our read and this point.
			// Re-check compatibility too — if that competitor was a NEWER build, we
			// must not interleave our older migrations behind its newer ones.
			const lockedLedger = readLedger(db);
			assertHistoryIsCompatible(lockedLedger, shipped, databaseFile);
			const lockedApplied = new Set(
				lockedLedger
					.filter((row) => row.rolled_back_at === null)
					.map((row) => row.migration_name),
			);
			const lockedPending = shipped.filter((m) => !lockedApplied.has(m.name));

			if (lockedPending.length > 0) {
				// Sample "does this database hold data?" HERE, under the write lock,
				// not before opening it. A competing process may have populated it in
				// between, and a stale "it was empty" reading would skip the backup on
				// a database that now has data in it. A zero-byte file is what
				// `new Database()` leaves behind and carries nothing worth preserving.
				const hadExistingData =
					existsSync(databaseFile) && statSync(databaseFile).size > 0;
				// Still nothing written by US at this point — the lock holds no data yet.
				if (hadExistingData) {
					backupFile = await backupDatabase(databaseFile);
					log(`Backed up ${databaseFile} to ${backupFile} before migrating.`);
				}

				db.exec(CREATE_MIGRATIONS_TABLE_SQL);
				for (const migration of lockedPending) {
					const startedAt = Date.now();
					log(`Applying migration ${migration.name}…`);
					db.exec(migration.sql);
					recordApplied(db, migration, startedAt);
					applied.push(migration.name);
				}
			}

			db.exec("COMMIT");
		} catch (error) {
			if (db.inTransaction) db.exec("ROLLBACK");
			throw error;
		}

		if (applied.length === 0) {
			log(
				"Another process applied the pending migrations first; nothing to do.",
			);
			return {
				status: "up-to-date",
				databaseFile,
				migrationsDir,
				applied: [],
				alreadyApplied,
				backupFile,
			};
		}

		log(`Applied ${applied.length} migration(s): ${applied.join(", ")}.`);
		return {
			status: "applied",
			databaseFile,
			migrationsDir,
			applied,
			alreadyApplied,
			backupFile,
		};
	} finally {
		db.close();
	}
}
