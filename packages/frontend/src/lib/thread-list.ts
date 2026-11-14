// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread list's model (#1101 category 1): Needs you on top with its full count,
 * pinned threads, every other thread flat, and Settled at the foot. Threads an agent
 * started are ordinary rows; those that need nothing sink below the rest. Pure, so
 * the order has tests.
 */
import type {
	ThreadRow,
	ThreadStatusInfo,
	ThreadUnit,
} from "@prismalens/contracts";
import { statusUrgency } from "@/components/kit/Status";
import { needsYouNow, statusOf } from "@/lib/thread-status";

export interface ListNode {
	id: string;
	thread: ThreadRow;
	info: ThreadStatusInfo;
	/** Last activity, ms. */
	at: number;
	/** The unit the node came from: an incident's chip, its section. */
	unit: ThreadUnit;
}

export interface ThreadListModel {
	needs: ListNode[];
	/** Every thread needing you, even beyond what loaded. */
	needsCount: number;
	pinned: ListNode[];
	active: ListNode[];
	settled: ListNode[];
	settledCount: number;
}

const time = (at: string | null | undefined) => (at ? Date.parse(at) : 0);

/** This device's view of a row's status over the server's, e.g. an ask it just answered. */
export type StatusAdjust = (
	t: ThreadRow,
	info: ThreadStatusInfo,
) => ThreadStatusInfo;

/** Every thread of a unit as its own row; an incident's threads are siblings too. */
export function nodesOf(
	unit: ThreadUnit,
	adjust: StatusAdjust = (_t, info) => info,
): ListNode[] {
	return unit.threads.map((t) => ({
		id: t.id,
		thread: t,
		info: adjust(t, statusOf(t)),
		at: time(t.lastActivityAt),
		unit,
	}));
}

/** An agent started it; a person's fork is not. */
export const agentStarted = (n: ListNode) =>
	n.thread.startedBy?.via === "agent";

/** Rows that need nothing recede: Done once seen, and Waiting. */
export function recedes(n: ListNode): boolean {
	if (n.thread.unseen) return false;
	return n.info.status === "done" || n.info.status === "waiting";
}

/** An agent-started row that needs nothing sinks below the rest (#1101 cat 1 item 1). */
const sinks = (n: ListNode) => agentStarted(n) && recedes(n);

const byRecency = (a: ListNode, b: ListNode) =>
	Number(sinks(a)) - Number(sinks(b)) || b.at - a.at;

/**
 * Needs you by the status registry's urgency (asks, then Blocked and Failed, then
 * Limited), then the longest wait first. Home and the sidebar read this one order.
 */
export const byUrgency = (a: ListNode, b: ListNode) =>
	statusUrgency(a.info.status) - statusUrgency(b.info.status) || a.at - b.at;

/** The list's sections from feed units; `needsCount` is the server's full count when it sent one. */
export function threadList(
	units: readonly ThreadUnit[],
	needsCount?: number,
	settledCount?: number,
	adjust?: StatusAdjust,
): ThreadListModel {
	const needs: ListNode[] = [];
	// Rows this device moved out of Needs you leave the server's count too.
	let left = 0;
	const pinned: ListNode[] = [];
	const active: ListNode[] = [];
	const settled: ListNode[] = [];
	for (const unit of units)
		for (const n of nodesOf(unit, adjust)) {
			if (adjust && needsYouNow(n.thread) && !needsYouNow(n.thread, n.info))
				left++;
			if (unit.section === "settled") settled.push(n);
			else if (needsYouNow(n.thread, n.info)) needs.push(n);
			else if (n.thread.pinnedAt) pinned.push(n);
			else active.push(n);
		}
	needs.sort(byUrgency);
	pinned.sort((a, b) => b.at - a.at);
	active.sort(byRecency);
	settled.sort((a, b) => b.at - a.at);
	return {
		needs,
		needsCount: Math.max((needsCount ?? 0) - left, needs.length),
		pinned,
		active,
		settled,
		settledCount: Math.max(settledCount ?? 0, settled.length),
	};
}
