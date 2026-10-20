// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Hypothesis, InvestigationReport } from "@prismalens/contracts";

/** The report's statuses mapped to the tree's words, never renamed (proposal item 5). */
export const NODE_WORD = {
	confirmed: "Confirmed",
	supported: "Likely",
	speculative: "Unconfirmed",
	refuted: "Ruled out",
} as const satisfies Record<Hypothesis["status"], string>;

export interface HypothesisNode {
	key: string;
	hypothesis: Hypothesis;
	children: HypothesisNode[];
	/** On the chain from a top-level idea down to the cause the run named. */
	winning: boolean;
}

export interface HypothesisTree {
	roots: HypothesisNode[];
	/** False when no hypothesis names a parent: the report predates links, and the view is a flat list. */
	linked: boolean;
	end: { kind: "cause"; text: string } | { kind: "none"; text: string };
}

/**
 * Builds the tree from `parentId` links. A link to an unknown id, to itself
 * or into a cycle is dropped and the node stands at the top, so a bad link
 * never hides a hypothesis. Children keep the report's plausibility order.
 */
export function hypothesisTree(
	report: Pick<InvestigationReport, "hypotheses" | "rootCause" | "summary">,
): HypothesisTree {
	const hs = report.hypotheses;
	const keyOf = hs.map((h, i) => h.id ?? `#${i}`);
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
	const top = report.rootCause
		? hs.findIndex((h) => h.status !== "refuted")
		: -1;
	const chain = new Set<number>();
	for (let p = top; p !== -1; p = parent[p] ?? -1) chain.add(p);
	const nodes = hs.map<HypothesisNode>((h, i) => ({
		key: keyOf[i] as string,
		hypothesis: h,
		children: [],
		winning: chain.has(i),
	}));
	const roots: HypothesisNode[] = [];
	nodes.forEach((n, i) => {
		const p = parent[i] ?? -1;
		(p === -1 ? roots : (nodes[p] as HypothesisNode).children).push(n);
	});
	return {
		roots,
		linked: parent.some((p) => p !== -1),
		end: report.rootCause
			? { kind: "cause", text: report.rootCause }
			: { kind: "none", text: report.summary },
	};
}
