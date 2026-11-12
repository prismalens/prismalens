// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which status moves are worth telling the operator about, and which of those may
 * notify (#1101 categories 3 and 4). Pure, so the rules have tests.
 */
import type { AttentionKind, ThreadStatus } from "@prismalens/contracts";

const ASKING: ReadonlySet<ThreadStatus> = new Set(["approval", "question"]);
/** A thread in one of these was still going: reaching Done from it is a finish. */
const GOING: ReadonlySet<ThreadStatus> = new Set([
	"working",
	"waiting",
	"approval",
	"question",
	"limited",
]);

export interface MoveFacts {
	/** The status the feed last saw; undefined when it never saw this thread. */
	prev: ThreadStatus | null | undefined;
	next: ThreadStatus;
	/** A trigger started it (an alert, a schedule), not a person. */
	triggered: boolean;
	/** It was created moments ago, so a first sighting is its start. */
	fresh: boolean;
}

/** The event a status move records, or null when it records none. */
export function attentionKindOf(m: MoveFacts): AttentionKind | null {
	const { next } = m;
	if (m.prev === undefined) {
		if (!m.fresh) return null;
		if (next === "working" || next === "waiting")
			return m.triggered ? "started" : null;
	}
	// A fresh thread first seen already stopped ran between two scans.
	const prev = m.prev === undefined ? "working" : m.prev;
	if (prev === next) return null;
	if (ASKING.has(next)) return ASKING.has(prev ?? "done") ? null : "needs_you";
	if (next === "limited") return "limited";
	if (next === "blocked") return "blocked";
	if (next === "failed") return "failed";
	if (next === "done" && prev && GOING.has(prev)) return "finished";
	return null;
}

export interface NotifyFacts {
	kind: AttentionKind;
	follow: "watch" | "mute" | null;
	/** A thread another thread started; its finish rolls into its parent. */
	child: boolean;
	triggered: boolean;
}

/**
 * Whether the event may raise a notification. Finishes notify only for threads the
 * operator started or watches, and a child's finish or failure rolls into its
 * parent, so 40 children never raise 40 alerts. A mute silences everything.
 */
export function mayNotify(f: NotifyFacts): boolean {
	if (f.follow === "mute") return false;
	if (f.kind === "started") return false;
	if (f.kind === "finished") {
		if (f.follow === "watch") return true;
		return !f.child && !f.triggered;
	}
	if (f.kind === "failed") return !f.child || f.follow === "watch";
	return true;
}

/** A status that no longer holds closes the events that announced it. */
export function staleKinds(next: ThreadStatus): AttentionKind[] {
	const stale: AttentionKind[] = [];
	if (!ASKING.has(next)) stale.push("needs_you");
	if (next !== "limited") stale.push("limited");
	if (next !== "blocked") stale.push("blocked");
	return stale;
}
