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

const norm = (s: string) =>
	s
		.trim()
		.toLowerCase()
		.replace(/^[/@#]+/, "");

/** A label's words, lower case: split at anything not a letter or digit, and at camelCase humps. */
function words(label: string): string[] {
	return label
		.replace(/^[/@#]+/, "")
		.split(/[^\p{L}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
}

/** `q` cut into consecutive chunks, each a prefix of a later word than the last: `pdw`, `prdesk`. */
function acronym(q: string, ws: string[]): boolean {
	const memo = new Map<string, boolean>();
	const from = (qi: number, wi: number): boolean => {
		if (qi === q.length) return true;
		const key = `${qi}:${wi}`;
		const known = memo.get(key);
		if (known !== undefined) return known;
		let ok = false;
		for (let w = wi; w < ws.length && !ok; w++) {
			const word = ws[w] as string;
			for (let k = 1; k <= word.length && qi + k <= q.length; k++) {
				if (word[k - 1] !== q[qi + k - 1]) break;
				if (from(qi + k, w + 1)) {
					ok = true;
					break;
				}
			}
		}
		memo.set(key, ok);
		return ok;
	};
	return from(0, 0);
}

/**
 * How `q` meets a label, strongest first (#1024): 1 the label is it or starts with it,
 * 2 a word starts with it, 3 its chunks start successive words, 4 a loose letter match.
 * Null when nothing matches; `fuzzy` orders tier 4.
 */
export function matchTier(
	q: string,
	label: string,
): { tier: 1 | 2 | 3 | 4; fuzzy: number } | null {
	const query = norm(q);
	const text = norm(label);
	if (!query) return { tier: 1, fuzzy: 1 };
	if (text.startsWith(query)) return { tier: 1, fuzzy: 1 };
	const lower = label.toLowerCase();
	for (const m of lower.matchAll(/[\p{L}\p{N}]+/gu))
		if (lower.startsWith(query, m.index)) return { tier: 2, fuzzy: 1 };
	const ws = words(label);
	const squeezed = query.replace(/[^\p{L}\p{N}]+/gu, "");
	if (squeezed && acronym(squeezed, ws)) return { tier: 3, fuzzy: 1 };
	const fuzzy = fuzzysort.single(q.trim(), label)?.score ?? 0;
	return fuzzy > 0 ? { tier: 4, fuzzy } : null;
}

/**
 * The match tier first; within a tier the boosts (the open panel, past picks, the
 * agent's touches), then an active thread, then the newest. `why` names the boost
 * that lifted the hit most, or `match` (#1024).
 */
export function rank(
	candidates: ReferenceCandidate[],
	q: string,
	boosts: RankBoosts,
	now = new Date(),
): ReferenceHit[] {
	const scored: {
		hit: ReferenceHit;
		tier: number;
		lift: number;
		fuzzy: number;
		active: boolean;
		at: number;
	}[] = [];
	for (const { active, at, ...c } of candidates) {
		const byLabel = matchTier(q, c.ref.label);
		// A path matches by its folders too; a record id is a UUID whose chunks would match any acronym.
		const byId =
			c.ref.kind === "file" || c.ref.kind === "folder"
				? matchTier(q, c.ref.id)
				: null;
		const m =
			byLabel && byId
				? byId.tier < byLabel.tier
					? byId
					: byLabel
				: (byLabel ?? byId);
		if (!m) continue;
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
		scored.push({
			hit: {
				...c,
				why: lifts[0]?.[0] ?? "match",
				// Tier dominates: each tier is worth 10, more than the boosts (at most 7.2) and fuzzy (1) together.
				score:
					Math.round(
						((5 - m.tier) * 10 + Math.min(lift, 2.4) * 3 + m.fuzzy) * 1000,
					) / 1000,
			},
			tier: m.tier,
			lift,
			fuzzy: m.fuzzy,
			active: active === true,
			at: at ?? 0,
		});
	}
	return scored
		.sort(
			(a, b) =>
				a.tier - b.tier ||
				b.lift - a.lift ||
				Number(b.active) - Number(a.active) ||
				b.fuzzy - a.fuzzy ||
				b.at - a.at ||
				a.hit.ref.label.localeCompare(b.hit.ref.label),
		)
		.map((s) => s.hit);
}
