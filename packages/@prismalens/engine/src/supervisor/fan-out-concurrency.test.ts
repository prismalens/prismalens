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

	it("one branch throwing terminates only itself (after its one respawn); siblings complete", async () => {
		let b0Attempts = 0;
		const harness: HarnessRunner = (_prompt, ctx) => {
			if (ctx.branchId === "b0") {
				b0Attempts++;
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
		// b0 gets exactly one respawn (bounded), then its throw is reshaped into a
		// terminal `error` event stamped with its branchId.
		expect(b0Attempts).toBe(2);
		const b0 = seen.filter((e) => "branchId" in e && e.branchId === "b0");
		expect(b0.map((e) => e.kind)).toEqual([
			"agent_step",
			"error", // respawn notice
			"agent_step",
			"error", // terminal
		]);
		const terminal = b0[3];
		expect(terminal.kind === "error" && terminal.message).toBe(
			"b0 transport exploded",
		);
		// (branchId, seq) stays monotonic across attempts.
		expect(b0.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
	});
});

describe("fan-out — N=1 failure containment (2026-07-07 hardening)", () => {
	const ROOT: Branch[] = [{ branchId: "root", prompt: "focus-root" }];

	it("mid-run abort after events flowed: one respawn, then contained as a terminal `error` event — evidence survives", async () => {
		let attempts = 0;
		const harness: HarnessRunner = (_prompt, ctx) => {
			attempts++;
			return (async function* () {
				yield agentStep(ctx.runId, "root", 0, "probing");
				yield toolResult(ctx.runId, "root", 1);
				throw new Error("EACCES: permission denied, scandir '/lost+found'");
			})();
		};

		const seen: CanonicalEvent[] = [];
		// Must NOT throw — the gathered evidence must reach the reduce step.
		for await (const ev of fanOut(ROOT, harness, "run-1")) seen.push(ev);

		expect(attempts).toBe(2);
		expect(seen.map((e) => e.kind)).toEqual([
			"agent_step",
			"tool_result",
			"error", // respawn notice
			"agent_step",
			"tool_result",
			"error", // terminal
		]);
		const notice = seen[2];
		expect(notice.kind === "error" && notice.message).toMatch(
			/respawning branch once/,
		);
		const terminal = seen[5];
		expect(terminal.kind === "error" && terminal.message).toContain("EACCES");
		expect("branchId" in terminal && terminal.branchId).toBe("root");
		// (branchId, seq) stays monotonic across the respawned attempt (re-stamped).
		expect(seen.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("respawn SUCCEEDS: the retry's evidence flows, no terminal error, no throw", async () => {
		let attempts = 0;
		const harness: HarnessRunner = (_prompt, ctx) => {
			attempts++;
			if (attempts === 1) {
				return (async function* () {
					yield agentStep(ctx.runId, "root", 0, "first-try");
					throw new Error("harness turn aborted");
				})();
			}
			return (async function* () {
				yield agentStep(ctx.runId, "root", 0, "second-try");
				yield toolResult(ctx.runId, "root", 1);
			})();
		};

		const seen: CanonicalEvent[] = [];
		for await (const ev of fanOut(ROOT, harness, "run-1")) seen.push(ev);

		expect(attempts).toBe(2);
		expect(seen.map((e) => e.kind)).toEqual([
			"agent_step",
			"error", // respawn notice — the ONLY error event
			"agent_step",
			"tool_result",
		]);
		expect(seen.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
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
