/**
 * Workspace + session manager for engine runs (ADR-0010), simplified from the
 * retired pl orchestrator's session-manager.
 *
 * Layout under `<workspace.base_dir>` (default ~/.prismalens):
 *   sessions.json                      — the run index (runId -> SessionRecord)
 *   runs/<runId>/session.json          — per-run metadata mirror
 *   runs/<runId>/events.jsonl          — the canonical event stream (one JSON/line)
 *   runs/<runId>/report.json           — the synthesized InvestigationReport
 *
 * The index is the source of truth for create/get/update/list; each run dir also
 * mirrors its metadata so a run is self-describing on disk.
 */
import {
	appendFile,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";

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
}

const RUN_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

export function resolveBaseDir(baseDir?: string): string {
	return resolve(expandHome(baseDir ?? join(homedir(), ".prismalens")));
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
	const tmp = `${path}.tmp`;
	await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
	await rename(tmp, path);
}

export function createSessionManager(baseDir?: string): SessionManager {
	const base = resolveBaseDir(baseDir);
	const runsRoot = join(base, "runs");
	const indexPath = join(base, "sessions.json");

	function assertRunId(runId: string): void {
		if (!RUN_ID_RE.test(runId)) throw new Error(`Invalid runId: "${runId}"`);
	}

	function workspaceDir(runId: string): string {
		assertRunId(runId);
		return join(runsRoot, runId);
	}

	function metaPath(runId: string): string {
		return join(workspaceDir(runId), "session.json");
	}

	async function readIndex(): Promise<Record<string, SessionRecord>> {
		try {
			const raw = await readFile(indexPath, "utf-8");
			return JSON.parse(raw) as Record<string, SessionRecord>;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw err;
		}
	}

	async function upsertIndex(record: SessionRecord): Promise<void> {
		const index = await readIndex();
		index[record.runId] = record;
		await mkdir(base, { recursive: true });
		await writeJsonAtomic(indexPath, index);
	}

	const manager: SessionManager = {
		baseDir: base,
		workspaceDir,

		async create(input) {
			assertRunId(input.runId);
			const dir = workspaceDir(input.runId);
			await mkdir(dir, { recursive: true });
			const now = new Date().toISOString();
			const record: SessionRecord = {
				runId: input.runId,
				status: "running",
				...(input.alertname !== undefined
					? { alertname: input.alertname }
					: {}),
				...(input.agent !== undefined ? { agent: input.agent } : {}),
				...(input.repo !== undefined ? { repo: input.repo } : {}),
				workspacePath: dir,
				createdAt: now,
				updatedAt: now,
			};
			await writeJsonAtomic(metaPath(input.runId), record);
			await upsertIndex(record);
			return record;
		},

		async get(runId) {
			assertRunId(runId);
			const index = await readIndex();
			const fromIndex = index[runId];
			if (fromIndex) return fromIndex;
			try {
				return JSON.parse(
					await readFile(metaPath(runId), "utf-8"),
				) as SessionRecord;
			} catch {
				return null;
			}
		},

		async update(runId, updates) {
			const existing = await manager.get(runId);
			if (!existing) throw new Error(`Session "${runId}" not found`);
			const merged: SessionRecord = {
				...existing,
				...updates,
				runId,
				updatedAt: new Date().toISOString(),
			};
			await writeJsonAtomic(metaPath(runId), merged);
			await upsertIndex(merged);
			return merged;
		},

		async list(filter) {
			const index = await readIndex();
			let records = Object.values(index);
			if (filter?.status) {
				const wanted = filter.status;
				records = records.filter((r) => wanted.includes(r.status));
			}
			return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		},

		async appendEvent(runId, event) {
			const dir = workspaceDir(runId);
			await mkdir(dir, { recursive: true });
			await appendFile(
				join(dir, "events.jsonl"),
				`${JSON.stringify(event)}\n`,
				"utf-8",
			);
		},

		async readEvents(runId) {
			try {
				const raw = await readFile(
					join(workspaceDir(runId), "events.jsonl"),
					"utf-8",
				);
				return raw
					.split("\n")
					.filter((line) => line.trim().length > 0)
					.map((line) => JSON.parse(line) as CanonicalEvent);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw err;
			}
		},

		async writeReport(runId, report) {
			const dir = workspaceDir(runId);
			await mkdir(dir, { recursive: true });
			await writeJsonAtomic(join(dir, "report.json"), report);
		},

		async readReport(runId) {
			try {
				const raw = await readFile(
					join(workspaceDir(runId), "report.json"),
					"utf-8",
				);
				return JSON.parse(raw) as InvestigationReport;
			} catch {
				return null;
			}
		},
	};

	return manager;
}
