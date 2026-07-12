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
	});

	it("opens a fresh store on the first run without warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const db = openDatabase(testDir);
		expect(() => db.exec("SELECT run_id FROM runs LIMIT 1;")).not.toThrow();

		expect(warnSpy).not.toHaveBeenCalled();
		db.close();
	});
});
