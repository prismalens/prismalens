// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { formatClock } from "./format-time";

/** What the end line needs to know of its thread (#673 w59, DESIGN §3). */
export interface EndLineRun {
	kind?: string | null;
	status: string;
	hasReport?: boolean;
	/** A reportless stopped or failed investigation whose session reopens. */
	continuable?: boolean;
}

/** The engine's stop: a cancelled turn ends with this error event. */
export function isStopMessage(message: string): boolean {
	return /^investigation cancelled/i.test(message);
}

/** What the box can do next, said under the end line; null when there is nothing to add. */
export function endHint(run: EndLineRun): string | null {
	if (run.kind === "chat" || run.hasReport) return null;
	if (run.status === "cancelled")
		return run.continuable
			? "Investigate to finish the report, or ask about what it found."
			: null;
	if (run.status === "failed")
		return run.continuable
			? "Investigate to try the report again, or ask about what it found."
			: "Start a new run.";
	return null;
}

/**
 * How a message ended when the thread's standing did not change with it: a
 * follow-up on a reported investigation, or a chat's turn.
 */
export function messageEndLine(
	message: string,
	at: string | null | undefined,
): string {
	if (isStopMessage(message))
		return at ? `Stopped by you at ${formatClock(at)}` : "Stopped by you";
	return `The agent stopped: ${message.replace(/\.$/, "")}`;
}
