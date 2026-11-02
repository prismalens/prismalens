// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AskLinkState } from "@prismalens/contracts";

interface AskEvent {
	kind: string;
	title?: string;
	outcome?: string;
}

/** Where the ask a link names stands, read from its own events, never from whatever ask is current (#859). */
export function askLinkState(
	events: AskEvent[],
	runLive: boolean,
): { state: AskLinkState; title: string | null; outcome: string | null } {
	const ask = events.find((e) => e.kind === "permission_ask");
	const answer = events.find((e) => e.kind === "permission_answer");
	const title = ask?.title ?? answer?.title ?? null;
	if (!ask && !answer) return { state: "unknown", title: null, outcome: null };
	if (!answer)
		return { state: runLive ? "waiting" : "run_ended", title, outcome: null };
	const outcome = answer.outcome ?? null;
	switch (outcome) {
		case "approved":
		case "denied":
		case "allowed":
		case "mode_kept":
			return { state: "answered", title, outcome };
		case "timed_out":
			return { state: "timed_out", title, outcome };
		case "unattended":
			return { state: "needed_approval", title, outcome };
		default:
			return { state: "run_ended", title, outcome };
	}
}
