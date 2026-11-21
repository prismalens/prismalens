// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the thread page reads these without loading a schema (#1130).

/**
 * A started thread's first prompt opens with this agent-only line; the transcript shows the
 * brief without it, the starter's name already linked above (#1101 - cat 10).
 */
export function startedByLine(name: string, link: string): string {
	return `Started by ${name} (${link}). If the brief asks you to report back, message it with pl_thread_send. Nothing is sent on your behalf.`;
}

/** The brief without its started-by line, or the text as it was. */
export function withoutStartedByLine(text: string): string {
	const m =
		/^Started by .*? \(\/[^)\s]+\)\. If the brief asks you to report back, message it with pl_thread_send\. Nothing is sent on your behalf\.\n*/.exec(
			text,
		);
	return m ? text.slice(m[0].length) : text;
}

/** A sent message reached a running thread now (steer) or at its next pause, reopened an idle one, or waits for it to run. */
export const THREAD_MESSAGE_OUTCOMES = [
	"next_pause",
	"steered",
	"reopened",
	"waiting",
] as const;
export type ThreadMessageOutcome = (typeof THREAD_MESSAGE_OUTCOMES)[number];

/** Items one fix thread takes at most (#1176). */
export const FIX_BATCH_MAX = 5;

/** How a thread came to be started from another (#1176): an agent's start, a person's fork, side question or fix. */
export const STARTED_BY_VIAS = ["agent", "fork", "side", "fix"] as const;
