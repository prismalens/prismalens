// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ListNode, ThreadListModel } from "@/lib/thread-list";

/** The sections a row can sit in, in list order. */
export type HoldSection = "needs" | "pinned" | "active" | "settled";
const SECTIONS: readonly HoldSection[] = [
	"needs",
	"pinned",
	"active",
	"settled",
];

/** Where each row sat when the reader entered the list, and what it showed then. */
export interface HeldLayout {
	order: Readonly<Record<HoldSection, readonly string[]>>;
	nodes: ReadonlyMap<string, ListNode>;
}

/** Where a held row goes once the list is let go: another section, or out of the list. */
export type Destination = HoldSection | "gone";

export interface Held {
	model: ThreadListModel;
	/** Rows drawn where they were, though the live list has them elsewhere. */
	moving: ReadonlyMap<string, Destination>;
	/** Rows that would move, arrive or leave once the hold ends: the Update pill's count. */
	pending: number;
}

export function layoutOf(m: ThreadListModel): HeldLayout {
	const nodes = new Map<string, ListNode>();
	const order = {} as Record<HoldSection, string[]>;
	for (const s of SECTIONS) {
		order[s] = m[s].map((n) => n.id);
		for (const n of m[s]) nodes.set(n.id, n);
	}
	return { order, nodes };
}

/**
 * The live list drawn in the held layout (#1247 D25): every row keeps its section and place.
 * A row still in its section takes its live content; one the live list moved or dropped keeps
 * what it showed, marked moving; a row that arrived waits. Counts stay live.
 */
export function heldModel(
	live: ThreadListModel,
	held: HeldLayout,
	/** The reader asked for more rows: new ones below a section's first held row join its foot. */
	tail = false,
): Held {
	const where = new Map<string, HoldSection>();
	const liveNode = new Map<string, ListNode>();
	for (const s of SECTIONS)
		for (const n of live[s]) {
			where.set(n.id, s);
			liveNode.set(n.id, n);
		}
	const moving = new Map<string, Destination>();
	const out = {} as Record<HoldSection, ListNode[]>;
	let pending = 0;
	for (const s of SECTIONS) {
		const ids = held.order[s];
		out[s] = ids.map((id) => {
			const now = where.get(id);
			if (now === s) return liveNode.get(id) as ListNode;
			moving.set(id, now ?? "gone");
			return held.nodes.get(id) as ListNode;
		});
		const liveIds = live[s].map((n) => n.id);
		if (tail) {
			// A later page's rows can sort among held ones; they join below them, and only a row
			// above every held one waits, as a new arrival (#1193 bar 17.5).
			const at = ids.map((id) => liveIds.indexOf(id)).filter((i) => i >= 0);
			const first = at.length ? Math.min(...at) : -1;
			for (const n of live[s].slice(first + 1))
				if (!held.nodes.has(n.id)) out[s].push(n);
		}
		// A shown row of this section that sits elsewhere in the live order moves on release.
		const shownHere = out[s]
			.map((n) => n.id)
			.filter((id) => where.get(id) === s);
		const kept = new Set(shownHere);
		const liveOrder = liveIds.filter((id) => kept.has(id));
		pending += shownHere.filter((id, i) => liveOrder[i] !== id).length;
	}
	const shown = new Set(SECTIONS.flatMap((s) => out[s].map((n) => n.id)));
	for (const id of where.keys())
		if (!held.nodes.has(id) && !shown.has(id)) pending++;
	pending += moving.size;
	return { model: { ...live, ...out }, moving, pending };
}

/**
 * The held layout with `ids` where the live list has them: a move the reader made applies
 * at once while the rest of the list stays held. Each lands after the live row before it.
 */
export function rebase(
	held: HeldLayout,
	live: ThreadListModel,
	ids: ReadonlySet<string>,
): HeldLayout {
	const order = {} as Record<HoldSection, string[]>;
	for (const s of SECTIONS)
		order[s] = held.order[s].filter((id) => !ids.has(id));
	const nodes = new Map(held.nodes);
	for (const s of SECTIONS)
		live[s].forEach((n, i) => {
			if (!ids.has(n.id)) return;
			const before = live[s]
				.slice(0, i)
				.map((m) => m.id)
				.filter((id) => order[s].includes(id))
				.at(-1);
			order[s].splice(before ? order[s].indexOf(before) + 1 : 0, 0, n.id);
			nodes.set(n.id, n);
		});
	for (const id of ids)
		if (!SECTIONS.some((s) => order[s].includes(id))) nodes.delete(id);
	return { order, nodes };
}

/** The section a row sits in, in a held layout or a live list; null when it is in neither. */
export function sectionOf(
	at: HeldLayout | ThreadListModel,
	id: string,
): HoldSection | null {
	const order = "order" in at ? at.order : null;
	for (const s of SECTIONS)
		if (
			order
				? order[s].includes(id)
				: (at as ThreadListModel)[s].some((n) => n.id === id)
		)
			return s;
	return null;
}
