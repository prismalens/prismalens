// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread list's model (#1101 category 1): Needs you on top with its full count,
 * pinned threads, roots that roll up their children, and Settled at the foot.
 * Pure, so the order and the roll-up have tests.
 */
import {
	rollUp,
	type ThreadRow,
	type ThreadStatus,
	type ThreadStatusInfo,
	type ThreadUnit,
} from "@prismalens/contracts";
import { needsYouNow, rollUpLine, statusOf } from "@/lib/thread-status";

export interface ListNode {
	id: string;
	thread: ThreadRow;
	info: ThreadStatusInfo;
	/** Last activity, ms. */
	at: number;
	/** Children in the thread tree, newest first. */
	children: ListNode[];
	/** Over itself and every descendant; null on a thread with no children. */
	rolled: { top: ThreadStatus; line: string; count: number } | null;
	/** The unit the node came from: an incident's chip, its section. */
	unit: ThreadUnit;
	/** Its root's title when it is a child, for a Needs-you row's "in ..." line. */
	parentTitle: string | null;
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

function nodeOf(
	t: ThreadRow,
	unit: ThreadUnit,
	parentTitle: string | null,
): ListNode {
	return {
		id: t.id,
		thread: t,
		info: statusOf(t),
		at: time(t.lastActivityAt),
		children: [],
		rolled: null,
		unit,
		parentTitle,
	};
}

function descendants(n: ListNode): ListNode[] {
	return n.children.flatMap((c) => [c, ...descendants(c)]);
}

/** One root per unit: a tree's root with its children under it, or the unit's newest thread. */
export function rootOf(unit: ThreadUnit): ListNode {
	const threads = unit.threads;
	const byId = new Map(threads.map((t) => [t.id, t]));
	const root =
		threads.find((t) => t.tree && t.tree.rootId === t.id) ??
		threads.find((t) => !t.tree?.parentId || !byId.has(t.tree.parentId)) ??
		(threads[0] as ThreadRow);
	const rootTitle = root.title?.trim() || "Thread";
	const nodes = new Map(
		threads.map((t) => [
			t.id,
			nodeOf(t, unit, t.id === root.id ? null : rootTitle),
		]),
	);
	const top = nodes.get(root.id) as ListNode;
	for (const t of threads) {
		if (t.id === root.id) continue;
		const parentId = t.tree?.parentId;
		const parent = (parentId && nodes.get(parentId)) || top;
		(parent === nodes.get(t.id) ? top : parent).children.push(
			nodes.get(t.id) as ListNode,
		);
	}
	const finish = (n: ListNode) => {
		n.children.sort((a, b) => b.at - a.at);
		for (const c of n.children) finish(c);
		const below = descendants(n);
		if (below.length) {
			const statuses = [n, ...below].map((d) => d.info.status);
			const { top: best } = rollUp(statuses);
			n.rolled = {
				top: best ?? n.info.status,
				line: rollUpLine(statuses),
				count: below.length,
			};
			n.at = Math.max(n.at, ...below.map((d) => d.at));
		}
	};
	finish(top);
	return top;
}

/** The list's sections from feed units; `needsCount` is the server's full count when it sent one. */
export function threadList(
	units: readonly ThreadUnit[],
	needsCount?: number,
	settledCount?: number,
): ThreadListModel {
	const needs: ListNode[] = [];
	const pinned: ListNode[] = [];
	const active: ListNode[] = [];
	const settled: ListNode[] = [];
	const waitedFrom = new Map<string, number>();
	let needing = 0;
	for (const unit of units) {
		const root = rootOf(unit);
		// A tree that needs you shows once, above, its root carrying the roll-up (#1101 cat 1).
		const waits = [root, ...descendants(root)].filter((n) =>
			needsYouNow(n.thread, n.info),
		);
		if (waits.length && unit.section !== "settled") {
			needs.push(root);
			needing += waits.length;
			waitedFrom.set(root.id, Math.min(...waits.map((n) => n.at)));
		}
		if (unit.section === "settled") settled.push(root);
		else if (root.thread.pinnedAt) pinned.push(root);
		else if (!waits.length) active.push(root);
	}
	// Oldest wait first: the thread that has waited longest is answered first.
	needs.sort(
		(a, b) => (waitedFrom.get(a.id) ?? a.at) - (waitedFrom.get(b.id) ?? b.at),
	);
	pinned.sort((a, b) => b.at - a.at);
	active.sort((a, b) => b.at - a.at);
	settled.sort((a, b) => b.at - a.at);
	return {
		needs,
		needsCount: Math.max(needsCount ?? 0, needing),
		pinned,
		active,
		settled,
		settledCount: Math.max(settledCount ?? 0, settled.length),
	};
}

/** Rows that need nothing recede: Done once seen, and Waiting. */
export function recedes(n: ListNode): boolean {
	if (n.thread.unseen) return false;
	const s = n.rolled?.top ?? n.info.status;
	return s === "done" || s === "waiting";
}
