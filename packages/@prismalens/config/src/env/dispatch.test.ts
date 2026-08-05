// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The dispatch schema's cross-field rule.
 *
 * A heartbeat that is not strictly faster than the staleness cutoff makes a HEALTHY run
 * reclaim itself: the sweeper judges every live claim dead before its holder can refresh
 * it, and the job reruns forever under a perfectly working process. That failure is
 * almost impossible to read from the symptom, so it is refused at boot instead.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertDispatchIntervals, dispatchSchema } from "./dispatch.js";

const guarded = dispatchSchema.superRefine(assertDispatchIntervals);

function parse(env: Record<string, string>) {
	return guarded.safeParse(env);
}

describe("dispatch schema", () => {
	it("accepts a heartbeat faster than the staleness cutoff", () => {
		const result = parse({
			PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS: "10000",
			PRISMALENS_DISPATCH_STALE_CLAIM_MS: "60000",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a heartbeat EQUAL to the staleness cutoff", () => {
		const result = parse({
			PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS: "60000",
			PRISMALENS_DISPATCH_STALE_CLAIM_MS: "60000",
		});
		expect(result.success).toBe(false);
		expect(
			(result as z.SafeParseError<unknown>).error.issues[0].message,
		).toContain("reclaims itself");
	});

	it("rejects a heartbeat SLOWER than the staleness cutoff", () => {
		const result = parse({
			PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS: "90000",
			PRISMALENS_DISPATCH_STALE_CLAIM_MS: "30000",
		});
		expect(result.success).toBe(false);
	});

	it("the defaults satisfy the rule", () => {
		const result = parse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(
				result.data.PRISMALENS_DISPATCH_HEARTBEAT_INTERVAL_MS,
			).toBeLessThan(result.data.PRISMALENS_DISPATCH_STALE_CLAIM_MS);
			// Fairness is a global cap and nothing more; this is the only knob for it.
			expect(result.data.PRISMALENS_DISPATCH_CONCURRENCY).toBe(3);
		}
	});
});
