// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SessionOpening, ThreadContext } from "@prismalens/contracts";

export type ThreadUsage = NonNullable<ThreadContext["usage"]>;

const compact = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** `840`, `2.2K`, `200K`, `1.2M`. */
export const shortCount = (n: number) => compact.format(n);

export type UsageTone = "warn" | "danger" | undefined;

/** The Context row: `{used} of {size}`, warn at 80% and danger at 90% (#1176 D10). */
export function contextWords(usage: ThreadUsage | undefined): {
	text: string;
	tone: UsageTone;
} {
	const c = usage?.context;
	if (!c || c.size <= 0) return { text: "Not reported", tone: undefined };
	const share = c.used / c.size;
	return {
		text: `${shortCount(c.used)} of ${shortCount(c.size)}`,
		tone: share >= 0.9 ? "danger" : share >= 0.8 ? "warn" : undefined,
	};
}

/** The Tokens row: `{total}, {turns} turns`; null at 0 turns. */
export function tokenWords(usage: ThreadUsage | undefined): string | null {
	if (!usage || usage.turns === 0) return null;
	return `${shortCount(usage.tokens.total)}, ${usage.turns} ${usage.turns === 1 ? "turn" : "turns"}`;
}

/** The Cost row: each currency's sum, `0.15 USD + 1.00 EUR`; null hides the row at 0 turns. */
export function costWords(
	usage: ThreadUsage | undefined,
): { text: string; hint: string | null } | null {
	if (!usage || usage.turns === 0) return null;
	const hint =
		usage.unpricedTurns > 0
			? `${usage.unpricedTurns} ${usage.unpricedTurns === 1 ? "turn" : "turns"} sent no cost.`
			: null;
	if (usage.costs.length === 0 || usage.unpricedTurns >= usage.turns)
		return { text: "Not priced", hint };
	return {
		text: usage.costs
			.map((c) => `${c.amount.toFixed(2)} ${c.currency}`)
			.join(" + "),
		hint,
	};
}

/** The Session row (#1176 D11): whether the newest opening kept the agent's session. */
export function sessionWord(
	session: SessionOpening | null | undefined,
): string {
	if (!session) return "Not recorded";
	return session.how === "resume" || session.how === "load"
		? "Same session"
		: "New session";
}
