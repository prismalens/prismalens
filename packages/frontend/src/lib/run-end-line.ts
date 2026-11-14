// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { failureLine, type RunFailure } from "@prismalens/contracts";
import { failureWords } from "./failure-words";
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
			? "Retry the run, or ask about the failure."
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
	failure?: Pick<RunFailure, "mode" | "window">,
	agent = "the agent",
): string {
	if (isStopMessage(message))
		return at ? `Stopped by you at ${formatClock(at)}` : "Stopped by you";
	// No status, "Internal error" or parser diagnostic reaches the line (#1101 cat 23 item 4).
	if (failure) return `${failureLine(failure, agent)}.`;
	const w = failureWords(message, agent);
	if (w.ours || w.plain) return w.next ? `${w.what} ${w.next}` : w.what;
	// An unknown stop still names one next step (#1101 cat 23).
	return `The agent stopped: ${w.what.replace(/\.$/, "")}. Reply to try again.`;
}
