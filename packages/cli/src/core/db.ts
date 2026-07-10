// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
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

export function openDatabase(baseDir: string): DatabaseSyncType {
	mkdirSync(baseDir, { recursive: true });
	const db = new DatabaseSync(join(baseDir, "prismalens.db"));

	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS groups (
			id         TEXT PRIMARY KEY,
			formed_by  TEXT NOT NULL DEFAULT 'window',
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS runs (
			run_id         TEXT PRIMARY KEY,
			group_id       TEXT REFERENCES groups(id),
			status         TEXT NOT NULL CHECK (status IN ('running','done','errored')),
			alertname      TEXT,
			agent          TEXT,
			repo           TEXT,
			workspace_path TEXT NOT NULL,
			error          TEXT,
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
	`);

	return db;
}
