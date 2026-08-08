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
			"Whether this process runs the dispatch loop. The EventBus is IN-PROCESS ONLY, so the process that runs the loop " +
				"is the only one that can stream a run's events or deliver a cancel to it: dispatch and the API must live in the " +
				"SAME process. This is not a role hint for splitting replicas — 'false' names a topology nothing here can serve " +
				"and is refused at boot (see assertDispatchTopology); it becomes usable only once a broker EventBus driver exists.",
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

/**
 * The topology guard: the API process must also be the dispatch process.
 *
 * The EventBus that carries a run's SSE relay and its cancel request is in-process only —
 * a `Map` of handler sets on one heap, with no transport. An API process that does not
 * run the dispatch loop therefore cannot reach the run at all, and both failures are
 * SILENT:
 *
 *   - the SSE stream opens 200, emits no frame, and never closes, because the run's
 *     events are published on another process's bus;
 *   - `requestCancel` finds zero receivers, so the API concludes nobody holds the run and
 *     writes the terminal state itself — on top of a run that is still executing. Two
 *     writers on one investigation, arrived at through the front door rather than a race.
 *
 * Enqueue, by contrast, goes through the database and works perfectly, so the shape looks
 * healthy until someone watches a stream or cancels a run. That is why this REFUSES
 * rather than warns: a warning is read once, in a log, by an operator whose system
 * appears to be working, and every consequence of ignoring it is invisible until it has
 * already corrupted an investigation's terminal state. There is no deployment today in
 * which `false` is correct, so the flag's only serviceable value is `true` until a broker
 * EventBus driver exists — at which point this guard is where its condition goes.
 */
export function assertDispatchTopology(config: {
	PRISMALENS_DISPATCH_ENABLED: boolean;
}): void {
	if (config.PRISMALENS_DISPATCH_ENABLED) return;
	throw new Error(
		"PRISMALENS_DISPATCH_ENABLED=false is not a serviceable configuration. The EventBus is in-process only, " +
			"so a process that serves the API without running the dispatch loop streams nothing (SSE opens and emits no " +
			"frames) and hears no cancel (requestCancel finds zero receivers, and the API then writes a terminal state over " +
			"a run that is still executing elsewhere). Run the API and the dispatch loop in the same process — the default — " +
			"or build a broker EventBus driver before splitting them.",
	);
}

export type DispatchConfig = z.infer<typeof dispatchSchema>;
