// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { killProcessTree } from "../process.js";

/** A setup is cancelled after this much silence; a teardown is cut off after this long (#925). */
export const SETUP_SILENCE_MS = 5 * 60_000;
export const TEARDOWN_CAP_MS = 60_000;

/** A user's shell command per OS family; the one for this platform runs. */
export interface OsCommands {
	posix?: string;
	windows?: string;
}

export type HookStatus = "ok" | "failed" | "silent" | "capped" | "aborted";

export interface HookResult {
	status: HookStatus;
	exitCode: number | null;
	/** The last 64 KiB of stdout and stderr, for the run log. */
	output: string;
}

export function commandFor(
	commands: OsCommands | undefined,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	const cmd = platform === "win32" ? commands?.windows : commands?.posix;
	return cmd?.trim() ? cmd : undefined;
}

/** Runs the user's own command in their shell; `silenceMs` restarts on each output chunk, `capMs` does not. */
export function runHook(
	command: string,
	opts: {
		cwd: string;
		env: Record<string, string>;
		silenceMs?: number;
		capMs?: number;
		onOutput?: (chunk: string) => void;
		signal?: AbortSignal;
	},
): Promise<HookResult> {
	return new Promise((resolve) => {
		const child = spawn(command, {
			cwd: opts.cwd,
			env: opts.env,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			windowsHide: true,
		});
		let output = "";
		let status: HookStatus | null = null;
		const stop = (why: HookStatus) => {
			status ??= why;
			killProcessTree(child, "SIGKILL");
		};
		let silence: NodeJS.Timeout | undefined;
		const arm = () => {
			if (!opts.silenceMs) return;
			clearTimeout(silence);
			silence = setTimeout(() => stop("silent"), opts.silenceMs);
		};
		const cap = opts.capMs
			? setTimeout(() => stop("capped"), opts.capMs)
			: undefined;
		const take = (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			output = (output + text).slice(-64 * 1024);
			opts.onOutput?.(text);
			arm();
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		arm();
		const abort = () => stop("aborted");
		opts.signal?.addEventListener("abort", abort, { once: true });
		if (opts.signal?.aborted) abort();
		const finish = (code: number | null) => {
			clearTimeout(silence);
			clearTimeout(cap);
			opts.signal?.removeEventListener("abort", abort);
			resolve({
				status: status ?? (code === 0 ? "ok" : "failed"),
				exitCode: code,
				output,
			});
		};
		child.once("error", (err) => {
			output += err.message;
			finish(null);
		});
		child.once("close", finish);
	});
}
