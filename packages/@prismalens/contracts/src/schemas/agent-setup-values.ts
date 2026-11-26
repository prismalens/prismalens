// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the thread page reads these without loading a schema (#1130).

/** Openings that reopen the session before them, so its system prompt is the one it had. */
const REOPENED = new Set(["resume", "load", "return"]);

/** The fields of a thread event `heldSharedRevision` reads. */
export interface SharedRevisionEvent {
	kind: string;
	how?: string;
	phase?: string;
	sharedSet?: { revision: string };
	sharedRevision?: string;
}

/**
 * The instructions revision a thread's session holds, `""` for none; null before any session.
 * Claude keeps a conversation's first system prompt until it compacts (#1180 §3.3), so a
 * reopen records the revision held before it and a completed compaction the one last sent.
 */
export function heldSharedRevision(
	events: readonly SharedRevisionEvent[],
): string | null {
	let held: string | null = null;
	for (const e of events) {
		if (e.kind === "session_opened")
			held =
				e.sharedSet?.revision ??
				(REOPENED.has(e.how ?? "") ? (held ?? "") : "");
		else if (
			e.kind === "compaction" &&
			e.phase === "completed" &&
			e.sharedRevision !== undefined
		)
			held = e.sharedRevision;
	}
	return held;
}
