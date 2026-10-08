// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The box's states (#673): a draft run, a live run, a stopped run that can
 * continue to its report, an ended run whose session reopens, or an ended
 * run whose agent kept no session.
 */
export type ComposerMode = "draft" | "live" | "continue" | "resume" | "ended";

export type ComposerKeyAction =
	| "investigate"
	| "queue"
	| "now"
	| "stop"
	| "blur"
	| null;

export interface ComposerKey {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey?: boolean;
	isComposing?: boolean;
}

/** Modes whose text goes to the run's own session. */
export function talksToSession(mode: ComposerMode): boolean {
	return mode === "live" || mode === "continue" || mode === "resume";
}

/**
 * What a key does in the box. Enter queues for the agent's next pause and
 * Ctrl/Cmd+Enter sends now; in a draft Enter starts the run. Esc stops a
 * working agent, else lets go of the box. Shift+Enter is a newline.
 */
export function composerKeyAction(
	e: ComposerKey,
	mode: ComposerMode,
	turnInFlight = mode === "live",
): ComposerKeyAction {
	if (e.isComposing) return null;
	if (e.key === "Escape") return turnInFlight ? "stop" : "blur";
	if (e.key !== "Enter" || e.shiftKey || e.altKey) return null;
	if (!talksToSession(mode)) return "investigate";
	return e.ctrlKey || e.metaKey ? "now" : "queue";
}

/** The box's mode from the selected run; null is the draft. */
export function composerMode(
	run: { live: boolean; continuable?: boolean; resumable?: boolean } | null,
): ComposerMode {
	if (!run) return "draft";
	if (run.live) return "live";
	if (run.continuable) return "continue";
	return run.resumable ? "resume" : "ended";
}
