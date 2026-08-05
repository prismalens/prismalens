// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * Dispatch configuration — the knobs of the in-process dispatch loop that claims
 * investigation jobs from the JobStore.
 *
 * Fairness here is a GLOBAL CONCURRENCY CAP and nothing else: there is no fairness
 * key, no weighted round-robin, and no per-key policy in the claim query.
 */
export const dispatchSchema = z.object({
	PRISMALENS_DISPATCH_CONCURRENCY: z.coerce
		.number()
		.int()
		.min(1, "Concurrency must be at least 1")
		.max(100, "Concurrency must not exceed 100")
		.default(3)
		.describe("Global cap on concurrently running investigation jobs"),
	PRISMALENS_DISPATCH_POLL_INTERVAL_MS: z.coerce
		.number()
		.int()
		.min(50)
		.default(1_000)
		.describe(
			"How often the dispatch loop polls the JobStore for claimable jobs",
		),
	PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS: z.coerce
		.number()
		.int()
		.min(100)
		.default(10_000)
		.describe("How often a running job refreshes its claim's heartbeat"),
	PRISMALENS_DISPATCH_STALE_CLAIM_MS: z.coerce
		.number()
		.int()
		.min(1_000)
		.default(60_000)
		.describe(
			"Age past which a claim's heartbeat is considered dead and the job is reclaimed (reclaim = rerun)",
		),
	PRISMALENS_DISPATCH_MAX_ATTEMPTS: z.coerce
		.number()
		.int()
		.min(1)
		.default(3)
		.describe("How many times a job may run before it is failed permanently"),
	PRISMALENS_DISPATCH_ENABLED: z
		.enum(["true", "false"])
		.default("true")
		.transform((v) => v === "true")
		.describe(
			"Whether this process runs the dispatch loop (the cloud role hint; every replica runs the same image)",
		),
	PRISMALENS_WORKER_ENTRY: z
		.string()
		.default("")
		.describe(
			"Explicit path to the per-run child entrypoint; empty resolves @prismalens/worker",
		),
});

/**
 * The heartbeat must be strictly faster than the staleness cutoff, or a healthy run
 * reclaims ITSELF: the sweeper would judge every live claim dead before its holder got
 * a chance to refresh it, and the job would rerun forever under a working process.
 * Caught at boot rather than as a mystifying reclaim loop in production.
 */
export function assertDispatchIntervals<
	T extends {
		PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS: number;
		PRISMALENS_DISPATCH_STALE_CLAIM_MS: number;
	},
>(
	config: T,
	ctx: {
		addIssue: (issue: {
			code: "custom";
			message: string;
			path: string[];
		}) => void;
	},
): void {
	if (
		config.PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS >=
		config.PRISMALENS_DISPATCH_STALE_CLAIM_MS
	) {
		ctx.addIssue({
			code: "custom",
			message:
				`PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS (${config.PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS}) must be strictly less than ` +
				`PRISMALENS_DISPATCH_STALE_CLAIM_MS (${config.PRISMALENS_DISPATCH_STALE_CLAIM_MS}) — otherwise a healthy run reclaims itself and reruns forever.`,
			path: ["PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS"],
		});
	}
}

export type DispatchConfig = z.infer<typeof dispatchSchema>;
