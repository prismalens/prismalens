// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunUsage } from "@prismalens/contracts";
import { formatClock } from "@/lib/format-time";

export interface UsageView {
	/** The model chip hint's sentence; null when nothing was reported, so the hint says nothing. */
	hint: string | null;
	/** Summary's Usage row: the reading, or "Not reported", never zero. */
	row: { text: string; sub: string };
	/** Its own row, only when the agent sent a cost with the usage. */
	cost: { text: string; sub: string } | null;
}

const n = (x: number) => x.toLocaleString("en-US");

const money = (amount: number) =>
	amount > 0 && amount < 0.01 ? "<0.01" : amount.toFixed(2);

/**
 * What the agent last reported in `usage_update`, worded for the model chip's
 * hint and Summary. It names no model (ruling 13), and a reading larger than
 * its context is shown as sent.
 */
export function usageView(
	usage: RunUsage | null | undefined,
	opts: { live: boolean; handedOff?: boolean },
): UsageView {
	if (!usage)
		return {
			hint: null,
			row: {
				text: "Not reported",
				sub: opts.live
					? "This session has sent no usage so far."
					: opts.handedOff
						? "This session sent no usage. That is not zero."
						: "No usage arrived for this run. That is not zero.",
			},
			cost: null,
		};
	const at = formatClock(usage.at);
	const of = usage.size > 0 ? ` of a ${n(usage.size)}-token context` : "";
	const pct = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0;
	const sub =
		usage.size === 0
			? `Last reported at ${at}.`
			: usage.used > usage.size
				? `Reported against a ${n(usage.size)}-token context (${pct}%). The agent sent more tokens than the context holds; shown as sent.`
				: `${pct}% of a ${n(usage.size)}-token context, last reported at ${at}.`;
	return {
		hint: `This session last reported ${n(usage.used)} tokens${of}, at ${at}.`,
		row: { text: `${n(usage.used)} tokens`, sub },
		cost: usage.cost
			? {
					text: `${money(usage.cost.amount)} ${usage.cost.currency}`,
					sub: "As reported with the usage. PrismaLens does not price runs.",
				}
			: null,
	};
}
