// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Readable, Writable } from "node:stream";

/** Wall-clock deadline for one harness run (ms). Past it the child is SIGKILLed. */
export interface RunLimits {
	wallClockMs?: number;
}

export interface LaunchOptions {
	/** The run's snapshot; never the user's checkout (ADR 0004 §2). */
	cwd: string;
	/** Provider keys for this harness. Layered over the allowlist, never process.env (ADR 0004 §5). */
	env?: NodeJS.ProcessEnv;
	limits?: RunLimits;
}

/** The duplex-stdio child a runner drives: ACP is line-delimited JSON-RPC over these pipes. */
export interface HarnessChild {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	killed: boolean;
	/** True once the wall-clock timer SIGKILLed this child. */
	timedOut?: boolean;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "error", listener: (err: Error) => void): this;
	on(
		event: "close",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): this;
}

/** Spawns the harness as a child of the API. One per run; `destroy()` reaps stragglers. */
export interface HarnessLauncher {
	spawn(command: string, args: string[], options: LaunchOptions): HarnessChild;
	destroy(): Promise<void>;
}
