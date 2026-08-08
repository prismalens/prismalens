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
import {
	assertDispatchIntervals,
	assertDispatchTopology,
	dispatchSchema,
} from "./dispatch.js";

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

/**
 * The topology rule. The EventBus is in-process only, so the process running the loop is
 * the only one that can stream a run or cancel it. A process that serves the API without
 * the loop looks healthy — enqueue goes through the database and works — while its SSE
 * streams emit nothing and its cancels reach nobody, at which point the API writes a
 * terminal state over a run that is still executing. That is refused, not warned about.
 */
describe("the dispatch topology guard", () => {
	function describeOf(key: keyof typeof dispatchSchema.shape): string {
		return dispatchSchema.shape[key].description ?? "";
	}

	it("accepts a process that runs the dispatch loop", () => {
		expect(() =>
			assertDispatchTopology({ PRISMALENS_DISPATCH_ENABLED: true }),
		).not.toThrow();
	});

	it("refuses an API process that does not run the dispatch loop", () => {
		expect(() =>
			assertDispatchTopology({ PRISMALENS_DISPATCH_ENABLED: false }),
		).toThrow(/not a serviceable configuration/);
	});

	it("names both silent failures, so the message is actionable without the source", () => {
		let message = "";
		try {
			assertDispatchTopology({ PRISMALENS_DISPATCH_ENABLED: false });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("in-process");
		expect(message).toContain("cancel");
		expect(message).toContain("terminal state");
	});

	it("the flag documents the constraint instead of advertising split replicas", () => {
		const description = describeOf("PRISMALENS_DISPATCH_ENABLED");

		// The old text ("every replica runs the same image") advertised a topology the
		// in-process bus cannot serve, and was the only prose describing the flag.
		expect(description).toMatch(/in-process/i);
		expect(description).toMatch(/same process/i);
		expect(description).not.toMatch(/replica runs the same image/i);
	});
});
