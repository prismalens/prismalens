// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ChildProcess, spawn } from "node:child_process";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import type { RetrievalReason } from "@prismalens/contracts";
import {
	buildChildEnv,
	windowsSpawnPlan,
	wrapWithTreeKill,
} from "@prismalens/engine";

/**
 * The user's own cloud credentials for the user's own kubectl, so kubeconfig
 * exec plugins keep working (spec R1). Not an edit to the engine's allowlist.
 */
export const CAPTURE_ENV_ALLOWLIST = [
	"KUBECONFIG",
	"AWS_PROFILE",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
	"AWS_CONFIG_FILE",
	"AWS_SHARED_CREDENTIALS_FILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"CLOUDSDK_CONFIG",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"AZURE_CONFIG_DIR",
] as const;

const STDERR_TAIL_BYTES = 2048;
/** After a kill, stop waiting for a grandchild that escaped the group still holding the pipes. */
const KILL_GRACE_MS = 2_000;

export class NoKubectlError extends Error {
	readonly code = "no-kubectl";
	constructor(bin: string) {
		super(`${bin} is not on PATH`);
		this.name = "NoKubectlError";
	}
}

export interface RunCommandInput {
	bin: string;
	argv: string[];
	timeoutMs: number;
	byteCap: number;
	signal?: AbortSignal;
}

export interface RunCommandResult {
	stdout: Buffer;
	stderrTail: string;
	exitCode: number | null;
	retrieval: "complete" | "partial";
	retrievalReason: RetrievalReason | null;
	startedAt: Date;
	endedAt: Date;
}

/** kubectl on PATH, or null. */
export function resolveKubectl(
	pathEnv = process.env.PATH ?? "",
): string | null {
	return resolveOnPath("kubectl", pathEnv);
}

export function captureEnv(
	source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const picked: NodeJS.ProcessEnv = {};
	for (const key of CAPTURE_ENV_ALLOWLIST) {
		if (source[key] !== undefined) picked[key] = source[key];
	}
	return buildChildEnv(picked);
}

const liveChildren = new Set<ChildProcess>();
let exitReapArmed = false;

/** Kills every live capture child's tree. Synchronous, so it is safe in an `exit` listener. */
export function reapLiveCaptures(): void {
	for (const child of liveChildren) child.kill("SIGKILL");
	liveChildren.clear();
}

/** Keeps the last `limit` bytes written. */
class TailBuffer {
	private chunks: Buffer[] = [];
	private size = 0;
	constructor(private readonly limit: number) {}
	push(chunk: Buffer): void {
		this.chunks.push(chunk);
		this.size += chunk.length;
		while (this.size - this.chunks[0].length >= this.limit) {
			this.size -= this.chunks[0].length;
			this.chunks.shift();
		}
	}
	text(): string {
		const all = Buffer.concat(this.chunks);
		return all.subarray(Math.max(0, all.length - this.limit)).toString("utf8");
	}
}

/** One bounded, read-only kubectl run: stdin closed, capped stdout, tree-killed on cap, timeout or abort. */
export function runCommand(input: RunCommandInput): Promise<RunCommandResult> {
	const { bin, argv, timeoutMs, byteCap, signal } = input;
	const startedAt = new Date();
	if (signal?.aborted) {
		return Promise.resolve({
			stdout: Buffer.alloc(0),
			stderrTail: "",
			exitCode: null,
			retrieval: "partial",
			retrievalReason: "timeout",
			startedAt,
			endedAt: startedAt,
		});
	}
	if (!exitReapArmed) {
		exitReapArmed = true;
		process.once("exit", reapLiveCaptures);
	}
	return new Promise((resolve, reject) => {
		const plan = windowsSpawnPlan(bin, argv);
		const child = wrapWithTreeKill(
			spawn(plan.command, plan.args, {
				...plan.options,
				stdio: ["ignore", "pipe", "pipe"],
				detached: process.platform !== "win32",
				windowsHide: true,
				env: captureEnv(),
			}),
		);
		liveChildren.add(child);

		const out: Buffer[] = [];
		let outBytes = 0;
		const errTail = new TailBuffer(STDERR_TAIL_BYTES);
		let cutReason: RetrievalReason | null = null;
		let settled = false;
		let graceTimer: NodeJS.Timeout | undefined;

		const cut = (reason: RetrievalReason): void => {
			if (cutReason !== null) return;
			cutReason = reason;
			child.kill("SIGKILL");
			graceTimer = setTimeout(() => {
				child.stdout?.destroy();
				child.stderr?.destroy();
				finish(null);
			}, KILL_GRACE_MS);
			graceTimer.unref();
		};
		const onAbort = (): void => cut("timeout");
		const timer = setTimeout(() => cut("timeout"), timeoutMs);
		timer.unref();
		signal?.addEventListener("abort", onAbort, { once: true });

		const cleanup = (): void => {
			clearTimeout(timer);
			if (graceTimer) clearTimeout(graceTimer);
			signal?.removeEventListener("abort", onAbort);
			liveChildren.delete(child);
		};
		const finish = (code: number | null): void => {
			if (settled) return;
			settled = true;
			cleanup();
			const reason: RetrievalReason | null =
				cutReason ?? (code === 0 ? null : "error");
			resolve({
				stdout: Buffer.concat(out, outBytes),
				stderrTail: errTail.text(),
				exitCode: code,
				retrieval: reason === null ? "complete" : "partial",
				retrievalReason: reason,
				startedAt,
				endedAt: new Date(),
			});
		};

		child.stdout?.on("data", (chunk: Buffer) => {
			if (cutReason !== null) return;
			const room = byteCap - outBytes;
			if (chunk.length > room) {
				out.push(chunk.subarray(0, room));
				outBytes += room;
				cut("byte-cap");
				return;
			}
			out.push(chunk);
			outBytes += chunk.length;
		});
		child.stderr?.on("data", (chunk: Buffer) => errTail.push(chunk));
		child.on("error", (err: NodeJS.ErrnoException) => {
			if (settled) return;
			if (err.code === "ENOENT") {
				settled = true;
				cleanup();
				reject(new NoKubectlError(bin));
				return;
			}
			errTail.push(Buffer.from(err.message));
			finish(null);
		});
		child.on("close", (code: number | null) => finish(code));
	});
}
