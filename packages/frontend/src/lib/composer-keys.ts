// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The box's modes (#743 §6): a brief for a new run, a message to the live
 * session, a follow-up that reopens an ended session (#747), or a brief for
 * the next run when the ended one cannot be reopened.
 */
export type ComposerMode = "brief" | "live" | "resume" | "again";

export type ComposerKeyAction = "investigate" | "queue" | "now" | null;

export interface ComposerKey {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey?: boolean;
	isComposing?: boolean;
}

/**
 * What a key does in the box. Enter queues a message for the agent's next
 * pause, Ctrl/Cmd+Enter sends it now; in brief mode both start the run.
 * Shift+Enter is a newline (null: the textarea's own behaviour).
 */
export function composerKeyAction(
	e: ComposerKey,
	mode: ComposerMode,
): ComposerKeyAction {
	if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.altKey) return null;
	if (mode !== "live" && mode !== "resume") return "investigate";
	return e.ctrlKey || e.metaKey ? "now" : "queue";
}

/** The box's mode from the selected run: none, live, ended and reopenable, or ended. */
export function composerMode(
	run: { live: boolean; resumable?: boolean } | null,
): ComposerMode {
	if (!run) return "brief";
	if (run.live) return "live";
	return run.resumable ? "resume" : "again";
}
