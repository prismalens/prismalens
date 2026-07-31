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
		const dbPath = join(testDir, "prismalens.db");
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
		expect(files.filter((f) => f.startsWith("prismalens.db.bak-"))).toEqual([]);
		db.close();
	});

	it("recovers from a stale schema, backs up the database, and emits a warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Create a deliberately stale database schema (missing run_id)
		const { mkdirSync, writeFileSync } = require("node:fs");
		mkdirSync(testDir, { recursive: true });
		const staleDbPath = join(testDir, "prismalens.db");
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
				f.startsWith("prismalens.db.bak-") &&
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

	it("throws on non-schema errors without creating a backup", () => {
		vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(() => {
			throw new Error("SQLITE_BUSY: database is locked");
		});

		expect(() => openDatabase(testDir)).toThrow(
			"SQLITE_BUSY: database is locked",
		);

		const files = readdirSync(testDir);
		const backups = files.filter((f) => f.startsWith("prismalens.db.bak-"));
		expect(backups.length).toBe(0);
	});
});
