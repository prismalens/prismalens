// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { DatabaseSync } from "node:sqlite";
import type { CanonicalEvent, InvestigationReport } from "@prismalens/contracts";
import type {
	CreateSessionInput,
	SessionManager,
	SessionRecord,
	SessionStatus,
} from "./session.js";

function tx<T>(db: DatabaseSync, fn: () => T): T {
	db.exec("BEGIN");
	try {
		const r = fn();
		db.exec("COMMIT");
		return r;
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}
}

interface RunRow {
	run_id: string;
	status: string;
	alertname: string | null;
	agent: string | null;
	repo: string | null;
	workspace_path: string;
	error: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	group_id: string | null;
}

function mapRun(row: RunRow): SessionRecord {
	const record: SessionRecord = {
		runId: row.run_id,
		status: row.status as SessionStatus,
		workspacePath: row.workspace_path,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.alertname) record.alertname = row.alertname;
	if (row.agent) record.agent = row.agent;
	if (row.repo) record.repo = row.repo;
	if (row.error) record.error = row.error;
	if (row.completed_at) record.completedAt = row.completed_at;
	return record;
}

export class SqliteSessionManager implements SessionManager {
	constructor(
		public readonly baseDir: string,
		private db: DatabaseSync,
		public readonly workspaceDir: (runId: string) => string,
		private assertRunId: (runId: string) => void,
	) {}

	async create(input: CreateSessionInput): Promise<SessionRecord> {
		this.assertRunId(input.runId);
		const dir = this.workspaceDir(input.runId);
		const { mkdirSync } = await import("node:fs");
		mkdirSync(dir, { recursive: true });
		const now = new Date().toISOString();

		return tx(this.db, () => {
			const insertGroup = this.db.prepare(`
				INSERT INTO groups (id, formed_by, created_at)
				VALUES (?, 'window', ?)
				ON CONFLICT DO NOTHING
			`);
			insertGroup.run(input.runId, now);

			const insertRun = this.db.prepare(`
				INSERT INTO runs (
					run_id, group_id, status, alertname, agent, repo,
					workspace_path, created_at, updated_at
				) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)
			`);
			insertRun.run(
				input.runId,
				input.runId,
				input.alertname ?? null,
				input.agent ?? null,
				input.repo ?? null,
				dir,
				now,
				now,
			);

			const getRun = this.db.prepare("SELECT * FROM runs WHERE run_id = ?");
			const row = getRun.get(input.runId) as unknown as RunRow | undefined;
			if (!row) throw new Error("Failed to read back created session");
			return mapRun(row);
		});
	}

	async get(runId: string): Promise<SessionRecord | null> {
		this.assertRunId(runId);
		const getRun = this.db.prepare("SELECT * FROM runs WHERE run_id = ?");
		const row = getRun.get(runId) as unknown as RunRow | undefined;
		return row ? mapRun(row) : null;
	}

	async update(
		runId: string,
		updates: Partial<Omit<SessionRecord, "runId">>,
	): Promise<SessionRecord> {
		const now = new Date().toISOString();
		
		return tx(this.db, () => {
			const existingStmt = this.db.prepare("SELECT * FROM runs WHERE run_id = ?");
			const existing = existingStmt.get(runId) as unknown as RunRow | undefined;
			if (!existing) throw new Error(`Session "${runId}" not found`);

			const status = updates.status ?? existing.status;
			const alertname = updates.alertname !== undefined ? updates.alertname : existing.alertname;
			const agent = updates.agent !== undefined ? updates.agent : existing.agent;
			const repo = updates.repo !== undefined ? updates.repo : existing.repo;
			const error = updates.error !== undefined ? updates.error : existing.error;
			const completedAt = updates.completedAt !== undefined ? updates.completedAt : existing.completed_at;

			const updateStmt = this.db.prepare(`
				UPDATE runs SET
					status = ?,
					alertname = ?,
					agent = ?,
					repo = ?,
					error = ?,
					completed_at = ?,
					updated_at = ?
				WHERE run_id = ?
			`);
			
			const res = updateStmt.run(
				status,
				alertname ?? null,
				agent ?? null,
				repo ?? null,
				error ?? null,
				completedAt ?? null,
				now,
				runId
			);

			if (res.changes === 0) {
				throw new Error(`Session "${runId}" not found`);
			}

			const row = existingStmt.get(runId) as unknown as RunRow | undefined;
			if (!row) throw new Error("Failed to read back updated session");
			return mapRun(row);
		});
	}

	async list(filter?: { status?: SessionStatus[] }): Promise<SessionRecord[]> {
		let query = "SELECT * FROM runs";
		let params: string[] = [];
		if (filter?.status && filter.status.length > 0) {
			const placeholders = filter.status.map(() => "?").join(",");
			query += ` WHERE status IN (${placeholders})`;
			params = [...filter.status];
		}
		query += " ORDER BY created_at DESC";

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...params) as unknown as RunRow[];
		return rows.map(mapRun);
	}

	async appendEvent(runId: string, event: CanonicalEvent): Promise<void> {
		const stmt = this.db.prepare(
			"INSERT INTO events(run_id, payload) VALUES(?, ?)",
		);
		stmt.run(runId, JSON.stringify(event));
	}

	async readEvents(runId: string): Promise<CanonicalEvent[]> {
		const stmt = this.db.prepare(
			"SELECT payload FROM events WHERE run_id = ? ORDER BY id",
		);
		const rows = stmt.all(runId) as unknown as { payload: string }[];
		return rows.map((r) => JSON.parse(r.payload) as CanonicalEvent);
	}

	async writeReport(runId: string, report: InvestigationReport): Promise<void> {
		const stmt = this.db.prepare(`
			INSERT INTO reports (run_id, payload)
			VALUES (?, ?)
			ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload
		`);
		stmt.run(runId, JSON.stringify(report));
	}

	async readReport(runId: string): Promise<InvestigationReport | null> {
		try {
			const stmt = this.db.prepare(
				"SELECT payload FROM reports WHERE run_id = ?",
			);
			const row = stmt.get(runId) as unknown as { payload: string } | undefined;
			if (!row) return null;
			return JSON.parse(row.payload) as InvestigationReport;
		} catch {
			return null;
		}
	}
}
