// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { LimitWindowSchema } from "./provider-failure.js";
import { AccessLevelSchema } from "./settings.js";

/** The Usage view's ranges (#1101 cat 17). */
export const USAGE_RANGES = ["24h", "7d", "30d"] as const;
export const UsageRangeSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(USAGE_RANGES),
);
export type UsageRange = z.infer<typeof UsageRangeSchema>;

export const UsageQuerySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		range: UsageRangeSchema.default("7d"),
		/** A project (repository) id; absent is every project. */
		project: z.string().min(1).optional(),
		/** An agent id; absent is every agent. */
		agent: z.string().min(1).optional(),
	}),
);
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

/** Token counts summed over the turns that reported them; an unreported field adds nothing. */
export const UsageTokensSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		input: z.number().int().nonnegative(),
		output: z.number().int().nonnegative(),
		cacheRead: z.number().int().nonnegative(),
		cacheWrite: z.number().int().nonnegative(),
		total: z.number().int().nonnegative(),
	}),
);
export type UsageTokens = z.infer<typeof UsageTokensSchema>;

/**
 * Cost as the agents reported it, an estimate. `amount` is null when no turn
 * in the bucket reported one; `unpricedTurns` counts the turns without it.
 */
export const UsageCostSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		amount: z.number().nonnegative().nullable(),
		currency: z.string().min(1),
		unpricedTurns: z.number().int().nonnegative(),
	}),
);
export type UsageCost = z.infer<typeof UsageCostSchema>;

export const UsageBucketSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		turns: z.number().int().nonnegative(),
		tokens: UsageTokensSchema,
		cost: UsageCostSchema,
	}),
);
export type UsageBucket = z.infer<typeof UsageBucketSchema>;

/** One day in the viewer's range; `day` is UTC `YYYY-MM-DD`, or the hour start for 24h. */
export const UsageDaySchema = /* @__PURE__ */ lazySchema(() =>
	UsageBucketSchema.extend({
		day: z.string(),
	}),
);
export type UsageDay = z.infer<typeof UsageDaySchema>;

export const UsageModelSchema = /* @__PURE__ */ lazySchema(() =>
	UsageBucketSchema.extend({
		/** The model id the agent named; `unknown` when a turn named none. */
		model: z.string(),
		agent: z.string().nullable(),
		days: z.array(UsageDaySchema),
	}),
);
export type UsageModel = z.infer<typeof UsageModelSchema>;

export const UsageSummarySchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		range: UsageRangeSchema,
		since: z.string().datetime(),
		until: z.string().datetime(),
		/** `hour` for 24h, else `day`. */
		step: z.enum(["hour", "day"]),
		totals: UsageBucketSchema,
		threads: z.number().int().nonnegative(),
		days: z.array(UsageDaySchema),
		models: z.array(UsageModelSchema),
		/** What the scope pickers offer: projects and agents with any thread. */
		projects: z.array(z.object({ id: z.string(), name: z.string() })),
		agents: z.array(z.string()),
		/** Agents whose runs in range reported no turn usage at all. */
		silentAgents: z.array(z.string()),
	}),
);
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** One usage window as the agent last reported it (`agent_quota`). */
export const UsageWindowSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		window: LimitWindowSchema.nullable(),
		/** The agent's own name for it, such as `five_hour` or `seven_day_opus`. */
		type: z.string().nullable(),
		usedPercent: z.number().min(0).max(100).nullable(),
		resetsAt: z.string().datetime().nullable(),
		status: z.string().nullable(),
		/** When the agent reported it. */
		at: z.string().datetime(),
	}),
);
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

/** Used share at which a window reads near its limit, unless the agent warns first. */
export const USAGE_NEAR_PERCENT = 90;

/**
 * A window's state, one rule for the Usage view and for the thread a full window
 * parks (#1101): `full` is the agent's `rejected` or 100% used.
 */
export function usageWindowState(w: {
	usedPercent?: unknown;
	status?: unknown;
}): "full" | "near" | "room" | "unknown" {
	const used = typeof w.usedPercent === "number" ? w.usedPercent : null;
	if (w.status === "rejected" || (used !== null && used >= 100)) return "full";
	if (
		w.status === "allowed_warning" ||
		(used !== null && used >= USAGE_NEAR_PERCENT)
	)
		return "near";
	return used === null ? "unknown" : "room";
}

export const AgentLimitsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agent: z.string(),
		/** Empty: the agent reports no windows over ACP. */
		windows: z.array(UsageWindowSchema),
	}),
);
export const UsageLimitsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agents: z.array(AgentLimitsSchema),
	}),
);
export type UsageLimits = z.infer<typeof UsageLimitsSchema>;

/** What an agent enforced at a level, from the runs it made (#1101 cat 18). */
export const EnforcementRowSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		agent: z.string(),
		access: AccessLevelSchema,
		fidelity: z.enum(["enforced", "cooperative", "advisory"]),
		mechanism: z.string(),
		runs: z.number().int().positive(),
		lastAt: z.string().datetime(),
	}),
);
export type EnforcementRow = z.infer<typeof EnforcementRowSchema>;
export const EnforcementSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		rows: z.array(EnforcementRowSchema),
	}),
);
export type Enforcement = z.infer<typeof EnforcementSchema>;
