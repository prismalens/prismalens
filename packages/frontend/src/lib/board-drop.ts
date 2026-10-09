// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BoardColumn } from "./incident-board";

/**
 * What dropping a board card on a column does (#743, R1a). Columns follow
 * state, so each drop maps to at most one action; every action also has a
 * control on the card or the incident page.
 */
export type DropAction =
	| { kind: "investigate"; acknowledge: boolean }
	| { kind: "acknowledge" }
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
	/** The incident it was merged into; a merged card takes no drop (#673 w37). */
	mergedInto?: number | null;
	/** The incident's status admits Reopen: it is Resolved (R1a d4). */
	canReopen?: boolean;
	/** The incident's status admits Acknowledge: it is Triggered. */
	canAcknowledge?: boolean;
}

export function dropAction({
	from,
	to,
	live,
	canResolve,
	canReopen = false,
	canAcknowledge = false,
	mergedInto = null,
}: DropInput): DropAction {
	if (from === to) return { kind: "none" };
	if (mergedInto !== null)
		return { kind: "none", reason: `Merged into INC-${mergedInto}` };
	if (to === "needs_you") {
		return {
			kind: "none",
			reason: "Needs you follows from the incident's state",
		};
	}
	if (to === "working") {
		// A drop on Working is "I'm on it": it acknowledges too, or the card stays in Needs you (#673 walk 4).
		if (live)
			return canAcknowledge
				? { kind: "acknowledge" }
				: { kind: "none", reason: "Its run is already working" };
		// A Resolved incident goes back to work only by Reopen, asked first.
		return canReopen
			? { kind: "reopen-investigate" }
			: { kind: "investigate", acknowledge: canAcknowledge };
	}
	if (to === "concluded") {
		// A Resolved card back on Concluded is a plain Reopen, asked first (#673 w42).
		if (from === "resolved" && canReopen) return { kind: "reopen" };
		// Any live run stops, the one on a card waiting in Needs you too (#673 walk 4).
		if (live) return { kind: "stop" };
		return {
			kind: "none",
			reason: "Concluded follows from a finished investigation",
		};
	}
	// to === "resolved"
	if (!canResolve) return { kind: "none", reason: "Already resolved" };
	return { kind: "resolve", stopFirst: live };
}

/** What a drop on a column would do, said while a card is carried there (#673 walk 4). */
export function dropWord(action: DropAction): string {
	switch (action.kind) {
		case "investigate":
			return action.acknowledge
				? "drop to acknowledge it and start a run"
				: "drop to start a run";
		case "acknowledge":
			return "drop to acknowledge it";
		case "reopen-investigate":
			return "drop to reopen it and start a run";
		case "reopen":
			return "drop to reopen it";
		case "stop":
			return "drop to stop its run";
		case "resolve":
			return action.stopFirst
				? "drop to stop its run and resolve it"
				: "drop to resolve it";
		case "none":
			return action.reason ?? "dropping here changes nothing";
	}
}

/** The column Left or Right carries a card to, in board order; null at either end. */
export function columnBeside(
	key: string,
	from: BoardColumn,
	order: readonly BoardColumn[],
): BoardColumn | null {
	const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
	if (!step) return null;
	return order[order.indexOf(from) + step] ?? null;
}
