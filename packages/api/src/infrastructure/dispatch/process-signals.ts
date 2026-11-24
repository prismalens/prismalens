// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The one door to `process.kill` in API product code (#1154): a test fakes this module's callers
// through `ProcessHost` and never signals a real pid. Biome's `no-direct-clock` rule forbids the
// direct call everywhere else.

/** Sends `signal` to `pid` (a negative pid is its process group); throws as `process.kill` does. */
export const signalProcess = (
	pid: number,
	signal: NodeJS.Signals | 0,
): void => {
	process.kill(pid, signal);
};

/** True when `pid` exists: signal 0 delivers nothing, and EPERM means it exists but is not ours. */
export const isProcessAlive = (pid: number): boolean => {
	try {
		signalProcess(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};
