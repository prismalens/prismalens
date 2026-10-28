// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The abort reason when PrismaLens itself is closing, as opposed to the operator's Stop.
 * A run aborted with it writes no end, so boot can tell the cut from a stop (#981).
 */
export const SHUTDOWN_REASON = "prismalens-shutdown";

export function isShutdown(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true && signal.reason === SHUTDOWN_REASON;
}
