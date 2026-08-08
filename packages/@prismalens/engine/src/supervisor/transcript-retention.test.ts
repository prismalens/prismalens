// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Tier-1 retention budget.
 *
 * The supervisor's accumulated event stream used to grow without limit. That was
 * somebody else's memory when the loop ran in a dedicated worker slot; it now runs in
 * the API's forked child, so it gets a budget.
 *
 * The invariant that makes this safe: events are TRIMMED, never DROPPED. The retained
 * array's length is the seq the terminal events are numbered from, and the durable
 * record's `(branchId, seq)` identity depends on it — so a cap that removed elements
 * would corrupt the record it is meant to protect.
 */

import { describe, expect, it } from "vitest";
import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import {
	RETAINED_PREVIEW_CAP,
	RETAINED_TRANSCRIPT_BYTES,
	retainedEvent,
} from "./investigate.js";

const BASE = {
	runId: "run-1",
	branchId: "b1",
	path: [] as string[],
	seq: 0,
	ts: "2026-08-05T00:00:00.000Z",
};

function toolResult(preview: string): CanonicalEvent {
	return {
		...BASE,
		kind: "tool_result",
		result: {
			name: "curl",
			toolCallId: "tc-1",
			source: "curl prom",
			ok: true,
			preview,
		},
	} satisfies CanonicalEvent;
}

function agentStep(text: string): CanonicalEvent {
	return { ...BASE, kind: "agent_step", text, toolCalls: [] };
}

function errorEvent(message: string): CanonicalEvent {
	return { ...BASE, kind: "error", message };
}

const HUGE = "x".repeat(500_000);

describe("Tier-1 transcript retention", () => {
	describe("under budget", () => {
		it("passes a small event through untouched", () => {
			const event = toolResult("value 42");
			const { event: retained } = retainedEvent(event, 0);
			expect(retained).toBe(event);
		});

		it("caps an oversized tool_result preview at the transcript's own preview cap", () => {
			const { event: retained, bytes } = retainedEvent(toolResult(HUGE), 0);
			if (retained.kind !== "tool_result") throw new Error("kind changed");
			expect(retained.result.preview).toContain("…[truncated]");
			expect(retained.result.preview?.length).toBeLessThan(
				RETAINED_PREVIEW_CAP + 100,
			);
			expect(bytes).toBeLessThan(RETAINED_PREVIEW_CAP + 100);
		});

		it("caps an oversized agent_step, not only tool_results", () => {
			// A runaway reasoning block costs exactly the same memory as a runaway tool
			// preview; capping one and not the other is a cap in name only.
			const { event: retained } = retainedEvent(agentStep(HUGE), 0);
			if (retained.kind !== "agent_step") throw new Error("kind changed");
			expect(retained.text).toContain("…[truncated]");
			expect(retained.text.length).toBeLessThan(RETAINED_PREVIEW_CAP + 100);
		});

		it("caps an oversized error message", () => {
			const { event: retained } = retainedEvent(errorEvent(HUGE), 0);
			if (retained.kind !== "error") throw new Error("kind changed");
			expect(retained.message).toContain("…[truncated]");
			expect(retained.message.length).toBeLessThan(RETAINED_PREVIEW_CAP + 100);
		});
	});

	describe("once the whole budget is spent", () => {
		const spent = RETAINED_TRANSCRIPT_BYTES;

		it("replaces a tool_result preview outright — it could not reach the transcript anyway", () => {
			const { event: retained } = retainedEvent(toolResult(HUGE), spent);
			if (retained.kind !== "tool_result") throw new Error("kind changed");
			expect(retained.result.preview).toBe(
				"…[dropped: transcript budget exhausted]",
			);
		});

		it("replaces an agent_step's text outright", () => {
			const { event: retained } = retainedEvent(agentStep(HUGE), spent);
			if (retained.kind !== "agent_step") throw new Error("kind changed");
			expect(retained.text).toBe("…[dropped: transcript budget exhausted]");
		});

		it("bounds what a long flood of oversized events can retain", () => {
			let bytes = 0;
			for (let i = 0; i < 5_000; i++) {
				bytes += retainedEvent(toolResult(HUGE), bytes).bytes;
			}
			// Without the budget this would be 5000 x 500KB. The marker's own length is
			// the only per-event cost once the budget is spent.
			expect(bytes).toBeLessThan(RETAINED_TRANSCRIPT_BYTES + 500_000);
		});
	});

	it("never mutates the event it was given — the sink and store keep full fidelity", () => {
		const original = toolResult(HUGE);
		retainedEvent(original, 0);
		if (original.kind !== "tool_result") throw new Error("kind changed");
		expect(original.result.preview).toHaveLength(HUGE.length);
	});

	it("leaves kinds it does not budget alone", () => {
		const done: CanonicalEvent = {
			...BASE,
			kind: "branch_done",
			reason: "completed",
		};
		const { event: retained, bytes } = retainedEvent(done, 0);
		expect(retained).toBe(done);
		expect(bytes).toBe(0);
	});
});
