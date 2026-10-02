// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BoardColumn } from "./incident-board";

/**
 * What dropping a board card on a column does (#743). Columns are derived
 * from state, so each drop maps to at most one action; every action also has
 * a button on the incident page.
 */
export type DropAction =
	| { kind: "investigate" }
	| { kind: "stop" }
	| { kind: "resolve"; stopFirst: boolean }
	| { kind: "reopen" }
	| { kind: "none"; reason?: string };

export interface DropInput {
	from: BoardColumn;
	to: BoardColumn;
	/** The incident's latest run is live. */
	live: boolean;
	/** The incident's status admits Resolve. */
	canResolve: boolean;
	/** The incident's status admits Reopen (resolved or closed, walk u18). */
	canReopen?: boolean;
}

export function dropAction({
	from,
	to,
	live,
	canResolve,
	canReopen = false,
}: DropInput): DropAction {
	if (from === to) return { kind: "none" };
	if (to === "needs_you") {
		return {
			kind: "none",
			reason: "Needs you follows from the incident's state",
		};
	}
	if (to === "working") return { kind: "investigate" };
	if (to === "concluded") {
		if (from === "working") return { kind: "stop" };
		// Concluded is where an open incident with no live run sits, so a
		// resolved one (in Needs you, awaiting close) lands there reopened.
		if (canReopen) return { kind: "reopen" };
		return {
			kind: "none",
			reason: "Concluded follows from a finished investigation",
		};
	}
	// to === "resolved"
	if (!canResolve) {
		return { kind: "none", reason: "Already resolved" };
	}
	return { kind: "resolve", stopFirst: live };
}
