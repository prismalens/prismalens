// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The box's three modes (#743 §6): a brief for a new run, a message to the
 * live session, or a brief for the next run after this one ended.
 */
export type ComposerMode = "brief" | "live" | "again";

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
	if (mode !== "live") return "investigate";
	return e.ctrlKey || e.metaKey ? "now" : "queue";
}

/** The box's mode from the selected run: no run, a live one, or an ended one. */
export function composerMode(run: { live: boolean } | null): ComposerMode {
	if (!run) return "brief";
	return run.live ? "live" : "again";
}
