// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, PendingAsk } from "@prismalens/contracts";

/** A call the run's mode answered without a card: approved, or blocked (a mode switch, or nobody there). */
export interface AutoDecision {
	key: string;
	at: string;
	title: string;
	toolKind: string | null;
	outcome: "approved" | "blocked";
	why: "mode" | "mode-kept" | "unattended";
}

const DECIDED_READS = new Set(["read", "search"]);

/**
 * The `permission_answer` events no person answered, newest first. Reads and
 * searches are left out, as the transcript leaves them out (#673 w21).
 */
export function decidedForYou(
	events: readonly CanonicalEvent[],
): AutoDecision[] {
	const out: AutoDecision[] = [];
	for (const e of events) {
		if (e.kind !== "permission_answer") continue;
		const toolKind = e.toolKind ?? null;
		const base = {
			key: e.askId,
			at: e.ts,
			title: e.title ?? "A tool call",
			toolKind,
		};
		if (e.outcome === "allowed") {
			if (toolKind && DECIDED_READS.has(toolKind)) continue;
			out.push({ ...base, outcome: "approved", why: "mode" });
		} else if (e.outcome === "mode_kept" || e.outcome === "unattended")
			out.push({
				...base,
				outcome: "blocked",
				why: e.outcome === "mode_kept" ? "mode-kept" : "unattended",
			});
	}
	return out.reverse();
}

/**
 * The legacy permission asks the run dock already shows (#1090): their projection
 * offers no options. Every other open ask docks here.
 */
export const docksHere = (a: PendingAsk) =>
	!(a.kind === "permission" && (a.permission?.options.length ?? 0) === 0);
