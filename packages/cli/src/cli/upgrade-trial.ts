// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A service upgrade as a trial (#766): snapshot the database while the service
 * is stopped, start the new version, and keep it only once `/api/instance`
 * answers with this workspace's id and the new version. Otherwise restore the
 * snapshot and go back to the previous version. Files outside SQLite are not
 * rolled back.
 */

import {
	closeSync,
	copyFileSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { instanceUrl } from "./instance-check.js";

export const DB_FILES = [
	"prismalens.db",
	"prismalens.db-wal",
	"prismalens.db-shm",
] as const;
export const SNAPSHOT_DIR = "upgrade-snapshot";
const TRIAL_FILE = "trial.json";
const RESTORE_MARKER = "RESTORE";
export const OUTCOME_FILE = "upgrade-outcome.json";

export interface Trial {
	from: string;
	to: string;
	channel: string;
	startedAt: string;
}

export interface Outcome {
	from: string;
	to: string;
	result: "committed" | "rolled-back" | "restored-only";
	reason?: string;
	at: string;
}

function fsyncPath(path: string): void {
	const fd = openSync(path, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

/** Same-directory replace with file and directory fsync. */
function durableWrite(
	dir: string,
	name: string,
	data: string,
	mode = 0o644,
): void {
	const tmp = join(dir, `${name}.tmp`);
	writeFileSync(tmp, data, { mode });
	fsyncPath(tmp);
	renameSync(tmp, join(dir, name));
	fsyncPath(dir);
}

function durableCopy(src: string, dir: string, name: string): void {
	const tmp = join(dir, `${name}.tmp`);
	copyFileSync(src, tmp);
	fsyncPath(tmp);
	renameSync(tmp, join(dir, name));
}

export function readTrial(workspace: string): Trial | null {
	try {
		return JSON.parse(
			readFileSync(join(workspace, SNAPSHOT_DIR, TRIAL_FILE), "utf8"),
		) as Trial;
	} catch {
		return null;
	}
}

/**
 * Copies the database aside, once per upgrade: a snapshot left by an unfinished
 * trial is kept, since retaking it could capture that trial's migrations.
 */
export function takeSnapshot(workspace: string, trial: Trial): Trial {
	const existing = readTrial(workspace);
	if (existing) return existing;
	const dir = join(workspace, SNAPSHOT_DIR);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	for (const name of DB_FILES) {
		const src = join(workspace, name);
		if (existsSync(src)) durableCopy(src, dir, name);
	}
	// trial.json last: its presence means the snapshot is whole.
	durableWrite(dir, TRIAL_FILE, JSON.stringify(trial));
	return trial;
}

/** Puts the snapshot back. The marker makes a restore cut short finish on the next `pl up` or `pl upgrade`. */
export function restoreSnapshot(workspace: string): void {
	const dir = join(workspace, SNAPSHOT_DIR);
	durableWrite(dir, RESTORE_MARKER, "");
	for (const name of DB_FILES) {
		const saved = join(dir, name);
		if (existsSync(saved)) durableCopy(saved, workspace, name);
		else rmSync(join(workspace, name), { force: true });
	}
	fsyncPath(workspace);
}

export function restorePending(workspace: string): boolean {
	return existsSync(join(workspace, SNAPSHOT_DIR, RESTORE_MARKER));
}

/** Finishes an interrupted restore; true when there was one. Runs before anything opens the database. */
export function completePendingRestore(workspace: string): boolean {
	if (!restorePending(workspace)) return false;
	restoreSnapshot(workspace);
	const trial = readTrial(workspace);
	finish(workspace, {
		from: trial?.from ?? "unknown",
		to: trial?.to ?? "unknown",
		result: "restored-only",
		reason: "an interrupted rollback's database restore was completed",
		at: new Date().toISOString(),
	});
	return true;
}

/** Records the outcome, then drops the snapshot and any marker. */
export function finish(workspace: string, outcome: Outcome): void {
	durableWrite(workspace, OUTCOME_FILE, JSON.stringify(outcome));
	rmSync(join(workspace, SNAPSHOT_DIR), { recursive: true, force: true });
}

export function readOutcome(workspace: string): Outcome | null {
	try {
		return JSON.parse(
			readFileSync(join(workspace, OUTCOME_FILE), "utf8"),
		) as Outcome;
	} catch {
		return null;
	}
}

export interface InstanceInfo {
	instanceId?: string;
	version?: string;
}

export async function fetchInstance(
	base: string,
	fetchImpl: typeof fetch = fetch,
): Promise<InstanceInfo | string> {
	try {
		const res = await fetchImpl(instanceUrl(base), {
			redirect: "manual",
			signal: AbortSignal.timeout(3_000),
		});
		if (!res.ok) return `HTTP ${res.status}`;
		return (await res.json()) as InstanceInfo;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

/** How much of the log's end is read for its last lines: rollback never waits on a large log (#776 review). */
const LOG_TAIL_BYTES = 64 * 1024;

/** The last `maxLines` non-empty lines of `logPath`, read from at most its last 64 KiB. */
export function readLastLogLines(logPath: string, maxLines = 20): string[] {
	let fd: number | undefined;
	try {
		if (!existsSync(logPath)) return [];
		const size = statSync(logPath).size;
		const length = Math.min(size, LOG_TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		fd = openSync(logPath, "r");
		readSync(fd, buffer, 0, length, size - length);
		const lines = buffer.toString("utf8").split("\n");
		// A cut first line is partial, so it is dropped.
		if (length < size) lines.shift();
		return lines.filter((line) => line.length > 0).slice(-maxLines);
	} catch {
		return [];
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

const ERROR_LINE = /\b(error|fatal|exception|failed|cannot|E[A-Z]{3,})\b/i;

/** Pairing links and tokens a trial prints to its console; the reason is stored and shown later (#673). */
export function redactSecrets(line: string): string {
	return line
		.replace(/(\/pair)#[^\s"'<>]+/g, "$1#[redacted]")
		.replace(/(token["']?\s*[=:]\s*["']?)[^\s"'&,}]+/gi, "$1[redacted]");
}

/**
 * The one line that says why a trial died: the last error-looking line of its
 * console, else the last line, with secrets redacted. JSON log lines give their msg.
 */
export function failureLine(lines: string[]): string | null {
	const texts = lines
		.map((raw) => {
			const line = stripVTControlCharacters(raw).trim();
			try {
				const parsed: unknown = JSON.parse(line);
				if (parsed && typeof parsed === "object" && "msg" in parsed) {
					const { msg, level } = parsed as { msg: unknown; level?: unknown };
					const text = String(msg);
					return typeof level === "number" && level >= 50
						? `error: ${text}`
						: text;
				}
			} catch {}
			return line;
		})
		.filter((line) => line.length > 0);
	const pick = texts.findLast((line) => ERROR_LINE.test(line)) ?? texts.at(-1);
	return pick === undefined ? null : redactSecrets(pick);
}

export interface AwaitTrialInput {
	base: string;
	instanceId: string;
	version: string;
	deadlineMs: number;
	fetchImpl?: typeof fetch;
	intervalMs?: number;
	logPath?: string;
	serviceProbe?: () => boolean | Promise<boolean>;
}

/** Polls until the service is this workspace's instance on `version`; the last miss when the deadline passes. */
export async function awaitTrial(
	input: AwaitTrialInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const end = Date.now() + input.deadlineMs;
	let reason = "no answer";
	do {
		if (input.serviceProbe && (await input.serviceProbe())) {
			const line = input.logPath
				? failureLine(readLastLogLines(input.logPath, 20))
				: null;
			return {
				ok: false,
				reason: `${input.version} exited during the trial${line ? `: ${line}` : ""}${input.logPath ? ` (full log: ${input.logPath})` : ""}`,
			};
		}
		const info = await fetchInstance(input.base, input.fetchImpl);
		if (typeof info === "string") reason = `${input.base} ${info}`;
		else if (info.instanceId !== input.instanceId)
			reason = `${input.base} is a different instance`;
		else if (info.version !== input.version)
			reason = `${input.base} answers as ${info.version ?? "an unknown version"}`;
		else return { ok: true };
		await new Promise((r) => setTimeout(r, input.intervalMs ?? 1_000));
	} while (Date.now() < end);
	return {
		ok: false,
		reason: `no healthy ${input.version} in time: ${reason}`,
	};
}

export interface TrialDeps {
	workspace: string;
	trial: Trial;
	/** Waits for the trial; ok or why not. */
	check: () => Promise<{ ok: true } | { ok: false; reason: string }>;
	/** Stops the trial; true only once nothing holds the database. */
	stop: () => Promise<boolean> | boolean;
	start: () => boolean;
	/** Reinstates the previous runtime; a reason when this channel can't. */
	switchBack: () => string | null;
}

/**
 * Judges a started trial: commit, or stop it, restore, switch back and start the
 * previous version. A channel that can't switch back leaves the service stopped.
 */
export async function settleTrial(deps: TrialDeps): Promise<Outcome> {
	const { workspace, trial } = deps;
	const verdict = await deps.check();
	const at = () => new Date().toISOString();
	if (verdict.ok) {
		const outcome: Outcome = { ...pick(trial), result: "committed", at: at() };
		finish(workspace, outcome);
		return outcome;
	}
	if (!(await deps.stop())) {
		// Restoring under a live SQLite writer corrupts it; keep the snapshot for a retry.
		const outcome: Outcome = {
			...pick(trial),
			result: "restored-only",
			reason: `${verdict.reason}; ${trial.to} couldn't be stopped, so nothing is restored yet and pl upgrade retries`,
			at: at(),
		};
		durableWrite(workspace, OUTCOME_FILE, JSON.stringify(outcome));
		return outcome;
	}
	restoreSnapshot(workspace);
	const blocked = deps.switchBack();
	const restarted = blocked === null && deps.start();
	const outcome: Outcome = {
		...pick(trial),
		result: restarted ? "rolled-back" : "restored-only",
		reason: restarted
			? verdict.reason
			: `${verdict.reason}; ${blocked ?? `${trial.from} didn't start again`}, so the service is stopped`,
		at: at(),
	};
	finish(workspace, outcome);
	return outcome;
}

function pick(trial: Trial) {
	return { from: trial.from, to: trial.to };
}

/** Repoints the installer's `pl`/`prismalens` wrappers and receipt at a kept runtime. */
export function switchInstallerRuntime(input: {
	dataDir: string;
	binDir: string;
	version: string;
}): string | null {
	const runtime = join(input.dataDir, "runtime", input.version);
	if (!existsSync(join(runtime, "bin", "pl"))) {
		return `the installer no longer keeps ${input.version}`;
	}
	for (const name of ["pl", "prismalens"]) {
		const path = join(input.binDir, name);
		if (!existsSync(path)) continue;
		const body = readFileSync(path, "utf8").replace(
			/^exec ".*\/bin\/(pl|prismalens)"/m,
			`exec "${join(runtime, "bin", name)}"`,
		);
		durableWrite(input.binDir, name, body, 0o755);
	}
	const receipt = join(input.dataDir, "receipt");
	if (existsSync(receipt)) {
		durableWrite(
			input.dataDir,
			"receipt",
			readFileSync(receipt, "utf8").replace(
				/^version=.*$/m,
				`version=${input.version}`,
			),
		);
	}
	return null;
}
