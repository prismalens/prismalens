// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Thread-wide state for a windowed thread (#1101 cat 12): the server's materialized
 * open asks, queue and hypotheses, with only the events received since open laid
 * over them. Never replayed from a window, which holds a slice of the record.
 */
import {
	type CanonicalEvent,
	type PendingAsk,
	pendingAsks,
	type RecordedHypothesis,
	recordedFindings,
	type ThreadState,
} from "@prismalens/contracts";

/** Open asks: the server's, less those the delta closed, plus those it opened. */
export function overlayAsks(
	threadId: string,
	base: readonly PendingAsk[],
	delta: readonly CanonicalEvent[],
): PendingAsk[] {
	const closed = new Set<string>();
	for (const e of delta)
		if (e.kind === "ask_closed" || e.kind === "permission_answer")
			closed.add(e.askId);
	const opened = pendingAsks(threadId, delta);
	const out = base.filter((a) => !closed.has(a.askId));
	for (const a of opened)
		if (!out.some((b) => b.askId === a.askId)) out.push(a);
	return out;
}

/** The queue as `message_queued` events, so `queuedMessages` reads it beside the delta. */
export function queueEvents(
	threadId: string,
	queue: ThreadState["queue"],
): CanonicalEvent[] {
	return queue.map((q) => ({
		kind: "message_queued" as const,
		runId: threadId,
		branchId: "queue",
		path: [],
		seq: -1,
		ts: q.at,
		messageId: q.messageId,
		text: q.text,
	}));
}

/** Hypotheses by id, the delta's latest winning. */
export function overlayHypotheses(
	base: readonly RecordedHypothesis[],
	delta: readonly CanonicalEvent[],
): RecordedHypothesis[] {
	const byId = new Map(base.map((h) => [h.id, h]));
	for (const h of recordedFindings(delta).hypotheses) byId.set(h.id, h);
	return Array.from(byId.values());
}
