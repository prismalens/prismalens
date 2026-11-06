// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReferenceHit, ReferenceWhy } from "@prismalens/contracts";
import fuzzysort from "fuzzysort";
import type { ReferenceCandidate } from "./reference-provider.js";

/** Frecency halves every 7 days (#1024). */
export const FRECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** What lifts a hit above its match, strongest first when two apply. */
export const BOOST = { open: 1, used: 0.8, agent: 0.6 } as const;

export interface RankBoosts {
	/** Past picks by `kind:id`. */
	used: Map<string, { count: number; lastUsedAt: Date }>;
	/** What the agent touched in this thread, by `kind:id`. */
	agent: Set<string>;
	/** What the panel has open, by `kind:id`. */
	open?: string;
}

export const refKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

/** A pick's weight now: its count, halved for every half-life since it was last used. */
export function frecency(
	use: { count: number; lastUsedAt: Date },
	now: Date,
): number {
	const age = Math.max(0, now.getTime() - use.lastUsedAt.getTime());
	return use.count * 0.5 ** (age / FRECENCY_HALF_LIFE_MS);
}

/**
 * The fuzzy match, boosted by past picks, the agent's touches and the open panel.
 * `why` names the boost that lifted the hit most, or `match` (#1024).
 */
export function rank(
	candidates: ReferenceCandidate[],
	q: string,
	boosts: RankBoosts,
	now = new Date(),
): ReferenceHit[] {
	const query = q.trim();
	const hits: ReferenceHit[] = [];
	for (const c of candidates) {
		let match = 0.5;
		if (query) {
			const by = Math.max(
				fuzzysort.single(query, c.ref.label)?.score ?? 0,
				(fuzzysort.single(query, c.ref.id)?.score ?? 0) * 0.9,
			);
			if (by <= 0) continue;
			match = by;
		}
		const key = refKey(c.ref);
		const lifts: [ReferenceWhy, number][] = [];
		if (boosts.open === key) lifts.push(["open", BOOST.open]);
		const use = boosts.used.get(key);
		if (use) {
			const f = frecency(use, now);
			if (f > 0.05) lifts.push(["used", BOOST.used * Math.min(1, f / 3)]);
		}
		if (boosts.agent.has(key)) lifts.push(["agent", BOOST.agent]);
		lifts.sort((a, b) => b[1] - a[1]);
		const lift = lifts.reduce((sum, [, v]) => sum + v, 0);
		hits.push({
			...c,
			why: lifts[0]?.[0] ?? "match",
			score: Math.round((match + lift) * 1000) / 1000,
		});
	}
	return hits.sort(
		(a, b) => b.score - a.score || a.ref.label.localeCompare(b.ref.label),
	);
}
