// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The box's modes (#743 §6, R4.4): a brief for a new run, a message to the
 * live session, continuing a stopped run to its report, a follow-up that
 * reopens a finished session (#747), or a brief for a new run when nothing
 * can be reopened.
 */
export type ComposerMode = "brief" | "live" | "continue" | "resume" | "again";

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

/** Modes whose text goes to the run's own session rather than briefing a new one. */
export function talksToSession(mode: ComposerMode): boolean {
	return mode === "live" || mode === "continue" || mode === "resume";
}

/**
 * What a key does in the box (decision 18, R4.4). Enter queues for the agent's
 * next pause, Ctrl/Cmd+Enter sends now; in the brief modes both start the run.
 * Esc stops a working agent (Claude Code's interrupt key) and otherwise lets
 * go of the box. Shift+Enter is a newline (null: the field's own behaviour).
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

/** The box's mode from the selected run: none, live, stopped and reopenable, ended and reopenable, or ended. */
export function composerMode(
	run: { live: boolean; continuable?: boolean; resumable?: boolean } | null,
): ComposerMode {
	if (!run) return "brief";
	if (run.live) return "live";
	if (run.continuable) return "continue";
	return run.resumable ? "resume" : "again";
}
