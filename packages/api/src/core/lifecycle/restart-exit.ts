// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The exit code an update restart asks for (#724). Nest re-raises the stop
 * signal after its hooks, which a service manager reads as a clean stop and
 * never restarts; the lock's shutdown hook exits with this code instead.
 */
let requested: number | null = null;

export function requestRestartExit(code: number): void {
	requested = code;
}

export function restartExitCode(): number | null {
	return requested;
}
