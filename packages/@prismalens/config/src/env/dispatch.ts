// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * Dispatch configuration — the one knob of the in-process dispatch loop that
 * claims investigation jobs from the JobStore (0005 §2: one process, no
 * worker, no reclaim).
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
});

export type DispatchConfig = z.infer<typeof dispatchSchema>;
