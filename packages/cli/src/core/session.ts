// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Workspace + session manager for engine runs (ADR-0010), simplified from the
 * retired pl orchestrator's session-manager.
 *
 * Layout under `<workspace.base_dir>` (default ~/.prismalens):
 *   prismalens.db                      - sqlite store for all run metadata
 *   runs/<runId>/                      - per-run workspace dir
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getAppDataDir } from "@prismalens/config/investigation";
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";
import { openDatabase } from "./db.js";
import { SqliteSessionManager } from "./sqlite-session-store.js";

export type SessionStatus = "running" | "done" | "errored";

export interface SessionRecord {
	runId: string;
	status: SessionStatus;
	alertname?: string;
	/** Harness backend driving the run (agent.default). */
	agent?: string;
	/** Repository under investigation (owner/name). */
	repo?: string;
	/** Absolute path to this run's workspace dir. */
	workspacePath: string;
	error?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface CreateSessionInput {
	runId: string;
	alertname?: string;
	agent?: string;
	repo?: string;
}

export interface GroupRecord {
	groupKey: string;
	formedBy: "window" | "overlay";
	alerts: Record<string, unknown>[];
	lateAlerts: Record<string, unknown>[];
}

export interface SessionManager {
	/** Resolved workspace base dir. */
	readonly baseDir: string;
	/** Absolute path to a run's workspace dir. */
	workspaceDir(runId: string): string;
	create(input: CreateSessionInput): Promise<SessionRecord>;
	get(runId: string): Promise<SessionRecord | null>;
	update(
		runId: string,
		updates: Partial<Omit<SessionRecord, "runId">>,
	): Promise<SessionRecord>;
	list(filter?: { status?: SessionStatus[] }): Promise<SessionRecord[]>;
	/** Append one canonical event to the run's events.jsonl. */
	appendEvent(runId: string, event: CanonicalEvent): Promise<void>;
	readEvents(runId: string): Promise<CanonicalEvent[]>;
	writeReport(runId: string, report: InvestigationReport): Promise<void>;
	readReport(runId: string): Promise<InvestigationReport | null>;
	writeGroupRecord(runId: string, rec: GroupRecord): Promise<void>;
	appendGroupAlert(
		runId: string,
		alert: Record<string, unknown>,
	): Promise<void>;
}

const RUN_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

export function resolveBaseDir(baseDir?: string): string {
	// Honor PRISMALENS_USER_FOLDER for the default workspace (via getAppDataDir);
	// an explicit `workspace.base_dir` override still wins.
	if (!baseDir || baseDir === "~/.prismalens") return getAppDataDir();
	return resolve(expandHome(baseDir));
}

export function createSessionManager(baseDir?: string): SessionManager {
	const base = resolveBaseDir(baseDir);
	const db = openDatabase(base);
	
	const runsRoot = join(base, "runs");
	
	function assertRunId(runId: string): void {
		if (!RUN_ID_RE.test(runId)) throw new Error(`Invalid runId: "${runId}"`);
	}

	function workspaceDir(runId: string): string {
		assertRunId(runId);
		return join(runsRoot, runId);
	}

	return new SqliteSessionManager(base, db, workspaceDir, assertRunId);
}
