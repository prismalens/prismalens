// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type RunUsage, RunUsageSchema } from "@prismalens/contracts/schemas";

/**
 * An ACP `usage_update` as a {@link RunUsage}, or null when it is not the
 * shape the SDK defines. A harness that sends none gets no usage, never zeros.
 */
export function parseUsageUpdate(
	u: { used?: unknown; size?: unknown; cost?: unknown },
	now: Date = new Date(),
): RunUsage | null {
	const cost = u.cost as { amount?: unknown; currency?: unknown } | null;
	const parsed = RunUsageSchema.safeParse({
		used: u.used,
		size: u.size,
		...(cost && typeof cost === "object"
			? { cost: { amount: cost.amount, currency: cost.currency } }
			: {}),
		at: now.toISOString(),
	});
	if (parsed.success) return parsed.data;
	const bare = RunUsageSchema.safeParse({
		used: u.used,
		size: u.size,
		at: now.toISOString(),
	});
	return bare.success ? bare.data : null;
}
