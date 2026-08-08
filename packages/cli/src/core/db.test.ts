// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./db.js";

describe("openDatabase", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `prismalens-db-test-${Date.now()}`);
		await rm(testDir, { recursive: true, force: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("migrates a pre-ADR-0026 runs table in place — no replacement, defaults backfilled", () => {
		const { mkdirSync } = require("node:fs");
		mkdirSync(testDir, { recursive: true });
		const dbPath = join(testDir, "prismalens-cli.db");
		const oldDb = new DatabaseSync(dbPath);
		// The 0.3.x runs schema: everything current EXCEPT origin/schema_version.
		oldDb.exec(`
			CREATE TABLE groups (
				id TEXT PRIMARY KEY, group_key TEXT,
				formed_by TEXT NOT NULL DEFAULT 'window', created_at TEXT NOT NULL
			);
			CREATE TABLE runs (
				run_id TEXT PRIMARY KEY,
				group_id TEXT REFERENCES groups(id),
				status TEXT NOT NULL CHECK (status IN ('running','done','errored','suppressed')),
				alertname TEXT, agent TEXT, repo TEXT,
				workspace_path TEXT NOT NULL,
				error TEXT, suppression_reason TEXT,
				created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
			);
			CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(run_id), payload TEXT NOT NULL);
			CREATE TABLE reports (run_id TEXT PRIMARY KEY REFERENCES runs(run_id), payload TEXT NOT NULL);
			CREATE TABLE group_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL REFERENCES groups(id), late INTEGER NOT NULL, payload TEXT NOT NULL);
			INSERT INTO runs (run_id, status, workspace_path, created_at, updated_at)
			VALUES ('old-run-1', 'done', '/tmp/w', '2026-07-01', '2026-07-01');
		`);
		oldDb.close();

		const db = openDatabase(testDir);

		// The pre-existing row survives with backfilled stamp defaults.
		const row = db
			.prepare(
				"SELECT run_id, origin, schema_version FROM runs WHERE run_id = 'old-run-1'",
			)
			.get() as { run_id: string; origin: string; schema_version: number };
		expect(row).toEqual({
			run_id: "old-run-1",
			origin: "local",
			schema_version: 1,
		});

		// No backup was created — the database was migrated, not replaced.
		const files = readdirSync(testDir);
		expect(files.filter((f) => f.startsWith("prismalens-cli.db.bak-"))).toEqual([]);
		db.close();
	});

	it("recovers from a stale schema, backs up the database, and emits a warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Create a deliberately stale database schema (missing run_id)
		const { mkdirSync, writeFileSync } = require("node:fs");
		mkdirSync(testDir, { recursive: true });
		const staleDbPath = join(testDir, "prismalens-cli.db");
		const staleDb = new DatabaseSync(staleDbPath);
		staleDb.exec(`
			CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
			CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
		`);
		staleDb.exec(
			`INSERT INTO runs (id, status) VALUES ('sentinel-run-123', 'done');`,
		);
		staleDb.close();

		// Create fake sidecar files that would be left behind by an unclean shutdown
		writeFileSync(`${staleDbPath}-wal`, "fake wal data");
		writeFileSync(`${staleDbPath}-shm`, "fake shm data");

		// Open the database, which should detect the schema mismatch,
		// backup the old file, and create a fresh database.
		const db = openDatabase(testDir);

		// Assert startup succeeds and we can access the fresh schema
		expect(() => db.exec("SELECT run_id FROM runs LIMIT 1;")).not.toThrow();

		// Assert backup exists
		const files = readdirSync(testDir);
		const backupFile = files.find(
			(f) =>
				f.startsWith("prismalens-cli.db.bak-") &&
				!f.endsWith("-wal") &&
				!f.endsWith("-shm"),
		);
		expect(backupFile).toBeDefined();

		// Assert sidecars were moved alongside backup
		expect(files).toContain(`${backupFile}-wal`);
		expect(files).toContain(`${backupFile}-shm`);

		// Assert warning emitted
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toContain(
			"[!] Workspace schema is incompatible. Backed up old database to",
		);

		db.close();

		// Assert backup preserves data
		if (!backupFile) {
			throw new Error("Backup file missing");
		}
		const backupDb = new DatabaseSync(join(testDir, backupFile));
		const backupRow = backupDb
			.prepare("SELECT * FROM runs WHERE id = 'sentinel-run-123'")
			.get();
		// The additive-migration attempt may have widened the stale table with
		// backfilled stamp columns before the fallback ran; the backup's job is
		// preserving the user's data, not its exact column set.
		expect(backupRow).toMatchObject({ id: "sentinel-run-123", status: "done" });
		backupDb.close();
	});

	it("opens a fresh store on the first run without warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const db = openDatabase(testDir);
		expect(() => db.exec("SELECT run_id FROM runs LIMIT 1;")).not.toThrow();

		expect(warnSpy).not.toHaveBeenCalled();
		db.close();
	});

	it("writes to prismalens-cli.db and never creates the app's prismalens.db (#355)", () => {
		const db = openDatabase(testDir);
		db.prepare(
			"INSERT INTO runs (run_id, status, workspace_path, created_at, updated_at) VALUES (?, 'running', '/tmp/w', '2026-08-08', '2026-08-08')",
		).run("split-check");
		db.close();

		const files = readdirSync(testDir);
		expect(files).toContain("prismalens-cli.db");
		expect(files.some((f) => f.startsWith("prismalens.db"))).toBe(false);

		// The row landed in the CLI's own file, not somewhere else.
		const cliDb = new DatabaseSync(join(testDir, "prismalens-cli.db"));
		expect(
			cliDb.prepare("SELECT run_id FROM runs WHERE run_id = 'split-check'").get(),
		).toMatchObject({ run_id: "split-check" });
		cliDb.close();
	});

	it("refuses a file holding Prisma-owned tables instead of renaming it aside (#355)", () => {
		const { mkdirSync, readFileSync } = require("node:fs");
		mkdirSync(testDir, { recursive: true });

		// A pre-#355 shared file: drifted CLI tables AND the app's own tables.
		const sharedPath = join(testDir, "prismalens-cli.db");
		const shared = new DatabaseSync(sharedPath);
		shared.exec(`
			CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
			CREATE TABLE incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL);
			CREATE TABLE investigations (id TEXT PRIMARY KEY);
			INSERT INTO runs (id, status) VALUES ('drifted-run', 'done');
			INSERT INTO incidents (id, title) VALUES ('inc-1', 'payments latency');
		`);
		shared.close();
		const before = readFileSync(sharedPath);

		expect(() => openDatabase(testDir)).toThrow(
			/contains application data.*incidents, investigations/s,
		);

		// Nothing was renamed aside, and the file is byte-for-byte untouched.
		const files = readdirSync(testDir);
		expect(files.filter((f) => f.includes(".bak-"))).toEqual([]);
		expect(readFileSync(sharedPath).equals(before)).toBe(true);

		// The app's row is still readable.
		const check = new DatabaseSync(sharedPath);
		expect(
			check.prepare("SELECT title FROM incidents WHERE id = 'inc-1'").get(),
		).toMatchObject({ title: "payments latency" });
		check.close();
	});

	it("tells the operator about run history left in the old shared prismalens.db (#355)", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { mkdirSync } = require("node:fs");
		mkdirSync(testDir, { recursive: true });

		// The pre-#355 world: CLI run history sitting inside the app database.
		const legacyPath = join(testDir, "prismalens.db");
		const legacy = new DatabaseSync(legacyPath);
		legacy.exec(`
			CREATE TABLE runs (
				run_id TEXT PRIMARY KEY, status TEXT NOT NULL,
				workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
			);
			CREATE TABLE incidents (id TEXT PRIMARY KEY);
			INSERT INTO runs VALUES ('legacy-run-1', 'done', '/tmp/w', '2026-07-01', '2026-07-01');
			INSERT INTO runs VALUES ('legacy-run-2', 'done', '/tmp/w', '2026-07-02', '2026-07-02');
		`);
		legacy.close();

		const db = openDatabase(testDir);

		// The new store starts empty — the old rows are not copied...
		expect(
			db.prepare("SELECT COUNT(*) AS n FROM runs").get(),
		).toMatchObject({ n: 0 });
		db.close();

		// ...but the operator is told where they are, and how many.
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const message = String(warnSpy.mock.calls[0][0]);
		expect(message).toContain("2 earlier run(s)");
		expect(message).toContain(legacyPath);
		expect(message).toContain("NOT copied across");

		// The old file was not modified, and the app's table is intact.
		const stillThere = new DatabaseSync(legacyPath);
		expect(
			stillThere.prepare("SELECT COUNT(*) AS n FROM runs").get(),
		).toMatchObject({ n: 2 });
		expect(
			stillThere
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='incidents'",
				)
				.get(),
		).toBeDefined();
		stillThere.close();
	});

	it("throws on non-schema errors without creating a backup", () => {
		vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(() => {
			throw new Error("SQLITE_BUSY: database is locked");
		});

		expect(() => openDatabase(testDir)).toThrow(
			"SQLITE_BUSY: database is locked",
		);

		const files = readdirSync(testDir);
		const backups = files.filter((f) => f.startsWith("prismalens-cli.db.bak-"));
		expect(backups.length).toBe(0);
	});
});
