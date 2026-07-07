// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for fan-out's N>1 concurrency + failure isolation (ADR-0016
 * decision 2). No network / no LLM — fake harness generators only.
 *
 * Two properties matter:
 *  1. Branches run CONCURRENTLY and their events interleave into the one outgoing
 *     stream as they arrive (proved with a latch: the "fast" branch parks on a gate
 *     the "slow" branch opens — a SEQUENTIAL runner would deadlock, so completion
 *     itself proves concurrency, and the observed order proves interleaving).
 *  2. One branch throwing does NOT kill its siblings — the run continues and the
 *     failed branch is terminated with a synthesized `error` event (correct branchId).
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { Branch } from "./decompose.js";
import { fanOut } from "./fan-out.js";
import type { HarnessRunner } from "./investigate.js";

const BRANCHES: Branch[] = [
	{ branchId: "b0", prompt: "focus-0" },
	{ branchId: "b1", prompt: "focus-1" },
];

function agentStep(
	runId: string,
	branchId: string,
	seq: number,
	text: string,
): CanonicalEvent {
	return {
		kind: "agent_step",
		runId,
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		text,
		toolCalls: [],
	};
}

function toolResult(
	runId: string,
	branchId: string,
	seq: number,
): CanonicalEvent {
	return {
		kind: "tool_result",
		runId,
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		result: {
			name: "curl",
			toolCallId: `${branchId}-${seq}`,
			source: "curl prom",
			ok: true,
			preview: "up",
		},
	};
}

describe("fanOut — N>1 concurrency + interleaving (ADR-0016 decision 2)", () => {
	it("interleaves events from concurrent branches (would deadlock if sequential)", async () => {
		// b0 yields, then PARKS on `gate`; b1 opens the gate after its first event.
		// If fan-out ran branches one-after-another, b0 would wait forever for b1.
		let openGate!: () => void;
		const gate = new Promise<void>((resolve) => {
			openGate = resolve;
		});

		const harness: HarnessRunner = (_prompt, ctx) => {
			if (ctx.branchId === "b0") {
				return (async function* () {
					yield agentStep(ctx.runId, "b0", 0, "b0-first");
					await gate; // only b1 can unblock this
					yield agentStep(ctx.runId, "b0", 1, "b0-second");
				})();
			}
			return (async function* () {
				yield agentStep(ctx.runId, "b1", 0, "b1-first");
				openGate();
				yield agentStep(ctx.runId, "b1", 1, "b1-second");
			})();
		};

		const seen: CanonicalEvent[] = [];
		for await (const ev of fanOut(BRANCHES, harness, "run-1")) seen.push(ev);

		// All four events arrived (completion ⇒ concurrency).
		expect(seen).toHaveLength(4);
		// Every event keeps its own branchId (the interleave key, ADR-0008).
		const byBranch = (id: string) =>
			seen.filter((e) => "branchId" in e && e.branchId === id);
		expect(byBranch("b0")).toHaveLength(2);
		expect(byBranch("b1")).toHaveLength(2);
		// Interleaving: b1's first event lands BEFORE b0's second (b0 was parked).
		const idx = (t: string) =>
			seen.findIndex((e) => e.kind === "agent_step" && e.text === t);
		expect(idx("b1-first")).toBeLessThan(idx("b0-second"));
	});

	it("one branch throwing terminates only itself; siblings complete", async () => {
		const harness: HarnessRunner = (_prompt, ctx) => {
			if (ctx.branchId === "b0") {
				return (async function* () {
					yield agentStep(ctx.runId, "b0", 0, "b0-start");
					throw new Error("b0 transport exploded");
				})();
			}
			return (async function* () {
				yield agentStep(ctx.runId, "b1", 0, "b1-start");
				yield toolResult(ctx.runId, "b1", 1);
			})();
		};

		const seen: CanonicalEvent[] = [];
		// Must NOT throw — the pool isolates the failing branch.
		for await (const ev of fanOut(BRANCHES, harness, "run-1")) seen.push(ev);

		// b1 fully survives (its agent_step + tool_result both present).
		const b1 = seen.filter((e) => "branchId" in e && e.branchId === "b1");
		expect(b1.map((e) => e.kind)).toEqual(["agent_step", "tool_result"]);
		// b0's throw is reshaped into a terminal `error` event stamped with its branchId.
		const b0Error = seen.find(
			(e) => e.kind === "error" && "branchId" in e && e.branchId === "b0",
		);
		expect(b0Error).toBeDefined();
		expect(b0Error?.kind === "error" && b0Error.message).toContain(
			"b0 transport exploded",
		);
	});
});

describe("fan-out — N=1 failure containment (2026-07-07 hardening)", () => {
	const ROOT: Branch[] = [{ branchId: "root", prompt: "focus-root" }];

	it("mid-run abort after events flowed: contained as a terminal `error` event, evidence survives", async () => {
		const harness: HarnessRunner = (_prompt, ctx) =>
			(async function* () {
				yield agentStep(ctx.runId, "root", 0, "probing");
				yield toolResult(ctx.runId, "root", 1);
				throw new Error("EACCES: permission denied, scandir '/lost+found'");
			})();

		const seen: CanonicalEvent[] = [];
		// Must NOT throw — the gathered evidence must reach the reduce step.
		for await (const ev of fanOut(ROOT, harness, "run-1")) seen.push(ev);

		expect(seen.map((e) => e.kind)).toEqual([
			"agent_step",
			"tool_result",
			"error",
		]);
		const err = seen[2];
		expect(err.kind === "error" && err.message).toContain("EACCES");
		expect("branchId" in err && err.branchId).toBe("root");
		// seq continues the branch's own counter (after tool_result seq=1).
		expect(err.seq).toBe(2);
	});

	it("failure BEFORE the first event still propagates (actionable setup error)", async () => {
		const harness: HarnessRunner = () =>
			// biome-ignore lint/correctness/useYield: throw-only harness stub.
			(async function* () {
				throw new Error("spawn deepagents-acp ENOENT");
			})();

		const events = fanOut(ROOT, harness, "run-1");
		await expect(async () => {
			for await (const _ of events) {
				// drain
			}
		}).rejects.toThrow("spawn deepagents-acp ENOENT");
	});
});
