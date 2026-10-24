// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Hypothesis } from "@prismalens/contracts";

/** The report's statuses as the card's words, never renamed. */
export const STATUS_WORD = {
	confirmed: "Confirmed",
	supported: "Likely",
	speculative: "Unconfirmed",
	refuted: "Ruled out",
} as const satisfies Record<Hypothesis["status"], string>;

export interface HypothesisNode {
	key: string;
	/** Position in `report.hypotheses`, which numbers its citations. */
	index: number;
	hypothesis: Hypothesis;
	children: HypothesisNode[];
}

/**
 * `report.hypotheses` nested by `parentId`, in report order. A link to an
 * unknown id, to itself or into a cycle is dropped and the node stands at the
 * top; the first of two equal ids wins. Every hypothesis appears exactly once.
 */
export function hypothesisTree(hs: readonly Hypothesis[]): HypothesisNode[] {
	const indexOf = new Map<string, number>();
	hs.forEach((h, i) => {
		if (h.id && !indexOf.has(h.id)) indexOf.set(h.id, i);
	});
	const parent = hs.map((h, i) => {
		const p = h.parentId ? indexOf.get(h.parentId) : undefined;
		return p === undefined || p === i ? -1 : p;
	});
	for (let i = 0; i < hs.length; i++) {
		const seen = new Set([i]);
		for (let p = parent[i] ?? -1; p !== -1; p = parent[p] ?? -1) {
			if (seen.has(p)) {
				parent[i] = -1;
				break;
			}
			seen.add(p);
		}
	}
	const nodes = hs.map<HypothesisNode>((h, i) => ({
		key: `${i}:${h.id ?? ""}`,
		index: i,
		hypothesis: h,
		children: [],
	}));
	const roots: HypothesisNode[] = [];
	nodes.forEach((n, i) => {
		const p = parent[i] ?? -1;
		(p === -1 ? roots : (nodes[p] as HypothesisNode).children).push(n);
	});
	return roots;
}
