// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BoardColumn } from "./incident-board";

/**
 * What dropping a board card on a column does (#743, R1a). Columns follow
 * state, so each drop maps to at most one action; every action also has a
 * control on the card or the incident page.
 */
export type DropAction =
	| { kind: "investigate" }
	| { kind: "reopen-investigate" }
	| { kind: "reopen" }
	| { kind: "stop" }
	| { kind: "resolve"; stopFirst: boolean }
	| { kind: "none"; reason?: string };

export interface DropInput {
	from: BoardColumn;
	to: BoardColumn;
	/** The incident's latest run is live. */
	live: boolean;
	/** The incident's status admits the operator's Resolve (stored `close`). */
	canResolve: boolean;
	/** The incident's status admits Reopen: it is Resolved (R1a d4). */
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
	if (to === "working") {
		if (live) return { kind: "none", reason: "Its run is already working" };
		// A Resolved incident goes back to work only by Reopen, asked first.
		return canReopen ? { kind: "reopen-investigate" } : { kind: "investigate" };
	}
	if (to === "concluded") {
		if (from === "working" && live) return { kind: "stop" };
		// A Resolved card back on Concluded is a plain Reopen, asked first (#673 w42).
		if (from === "resolved" && canReopen) return { kind: "reopen" };
		return {
			kind: "none",
			reason: "Concluded follows from a finished investigation",
		};
	}
	// to === "resolved"
	if (!canResolve) return { kind: "none", reason: "Already resolved" };
	return { kind: "resolve", stopFirst: live };
}
