// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type LimitWindow,
	type RunUsage,
	RunUsageSchema,
	type TurnUsage,
	TurnUsageSchema,
} from "@prismalens/contracts/schemas";

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

/** A usage window from Claude Code's `_meta["_claude/rateLimit"]` on a `usage_update`, or null. */
export function quotaOf(meta: unknown): {
	window?: LimitWindow;
	type?: string;
	usedPercent?: number;
	resetsAt?: string;
	status?: string;
} | null {
	const info = (meta as Record<string, unknown> | null | undefined)?.[
		"_claude/rateLimit"
	] as Record<string, unknown> | null | undefined;
	if (!info || typeof info !== "object") return null;
	const type =
		typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
	const window: LimitWindow | undefined = !type
		? undefined
		: type === "five_hour"
			? "session"
			: /opus|sonnet|fable|haiku/.test(type)
				? "model"
				: type.startsWith("seven_day")
					? "weekly"
					: undefined;
	const u = typeof info.utilization === "number" ? info.utilization : null;
	// A fraction from the SDK; a value above 1 is already a percent.
	const usedPercent =
		u === null || u < 0 ? undefined : Math.min(100, u <= 1 ? u * 100 : u);
	const r = typeof info.resetsAt === "number" ? info.resetsAt : null;
	const resetsAt =
		r && r > 0 ? new Date(r < 1e12 ? r * 1000 : r).toISOString() : undefined;
	const status = typeof info.status === "string" ? info.status : undefined;
	if (usedPercent === undefined && !resetsAt && !status) return null;
	return {
		...(window ? { window } : {}),
		...(type ? { type: type.slice(0, 100) } : {}),
		...(usedPercent !== undefined
			? { usedPercent: Math.round(usedPercent * 10) / 10 }
			: {}),
		...(resetsAt ? { resetsAt } : {}),
		...(status ? { status: status.slice(0, 100) } : {}),
	};
}

const count = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

/**
 * The prompt response's `usage` (ACP, unstable) as one turn's consumption, or null
 * when the agent sent none. Claude Code, Gemini CLI and OpenCode send it; Codex
 * does not (#1101). The model is the one `_meta.quota.model_usage` names, if only one.
 */
export function turnUsageOf(res: unknown): TurnUsage | null {
	const r = res as {
		usage?: Record<string, unknown> | null;
		_meta?: { quota?: { model_usage?: unknown } } | null;
	} | null;
	const u = r?.usage;
	if (!u || typeof u !== "object") return null;
	const models = r?._meta?.quota?.model_usage;
	const named = Array.isArray(models)
		? [
				...new Set(
					models
						.map((m) => (m as { model?: unknown } | null)?.model)
						.filter((m): m is string => typeof m === "string" && !!m),
				),
			]
		: [];
	const parsed = TurnUsageSchema.safeParse({
		...(named.length === 1 ? { model: named[0] } : {}),
		inputTokens: count(u.inputTokens),
		outputTokens: count(u.outputTokens),
		cacheReadTokens: count(u.cachedReadTokens),
		cacheWriteTokens: count(u.cachedWriteTokens),
		thoughtTokens: count(u.thoughtTokens),
		totalTokens: count(u.totalTokens),
	});
	if (!parsed.success) return null;
	const kept = Object.fromEntries(
		Object.entries(parsed.data).filter(([, v]) => v !== undefined),
	) as TurnUsage;
	return Object.keys(kept).some((k) => k !== "model") ? kept : null;
}
