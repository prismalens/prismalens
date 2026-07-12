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
		SELECT group_key, formed_by FROM groups LIMIT 1;
		SELECT run_id, group_id, status, alertname, agent, repo, workspace_path, error, suppression_reason, created_at, updated_at, completed_at FROM runs LIMIT 1;
		SELECT id, run_id, payload FROM events LIMIT 1;
		SELECT run_id, payload FROM reports LIMIT 1;
		SELECT id, group_id, late, payload FROM group_alerts LIMIT 1;
`;

export function openDatabase(baseDir: string): DatabaseSyncType {
	mkdirSync(baseDir, { recursive: true });
	const dbPath = join(baseDir, "prismalens.db");
	let db = new DatabaseSync(dbPath);

	try {
		db.exec(SCHEMA);
		db.exec(SCHEMA_CHECK);
	} catch (_err) {
		// Schema mismatch or corruption detected.
		const backupPath = join(baseDir, `prismalens.db.bak-${Date.now()}`);
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
