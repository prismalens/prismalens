// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunUsage } from "@prismalens/contracts";

export interface UsageView {
	/** `182k tok (ctx 41%)`, or `usage not reported`. */
	text: string;
	title: string;
	reported: boolean;
}

function tokens(n: number): string {
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

/**
 * What the harness reported on its last `usage_update`. A run whose harness
 * sent none reads "not reported", never `0 tok`.
 */
export function usageView(
	usage: RunUsage | null | undefined,
	agent: string,
): UsageView {
	if (!usage)
		return {
			text: "usage not reported",
			title: `${agent} has not reported usage for this run. That is not zero.`,
			reported: false,
		};
	const ctx =
		usage.size > 0
			? ` (ctx ${Math.round((usage.used / usage.size) * 100)}%)`
			: "";
	const cost = usage.cost
		? `, cost ${usage.cost.amount.toFixed(2)} ${usage.cost.currency}`
		: "";
	return {
		text: `${tokens(usage.used)} tok${ctx}`,
		title: `${agent} reported ${usage.used.toLocaleString("en-US")} tokens in context of ${usage.size.toLocaleString("en-US")}${cost}.`,
		reported: true,
	};
}
