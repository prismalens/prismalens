// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the conductor primitive (ADR-0018): `conductRun` owns the
 * drive-loop + the durable STORE lifecycle (create → append per event → finish|fail)
 * and fans every event to the SINK. No network / no LLM — the harness is a fake
 * generator, and the no-evidence / error paths return BEFORE reduce() (the one
 * supervisor LLM call), so these run in the default suite (not the gated evals).
 *
 * We cover the no-evidence + error terminal paths (which need no LLM): a branch that
 * yields zero tool_results and ends in `error` makes investigateIncidentStream emit
 * no report and return before reduce(). The happy-path finish(report) assertion is
 * omitted here because producing a real report requires a live reduce() LLM call.
 */
import type { CanonicalEvent, FiringAlert } from "@prismalens/contracts";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { conductRun, type InvestigationStore } from "./conductor.js";
import {
	CANCELLED_MESSAGE,
	type HarnessRunner,
	type InvestigateOptions,
} from "./investigate.js";

/** Flush pending micro/macrotasks so a fire-and-forget generator.return() settles. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const TELEMETRY = {
	prometheusUrl: "http://prom:9090",
	alertmanagerUrl: "http://am:9093",
	apiUrl: "http://api:5000",
};

const SYNTH = { providerId: "ollama" as const, model: "gpt-oss:20b" };

function alert(name: string): FiringAlert {
	return {
		alertname: name,
		severity: "critical",
		labels: {},
		annotations: {},
		startsAt: null,
	};
}

function agentStep(
	runId: string,
	branchId: string,
	seq: number,
): CanonicalEvent {
	return {
		kind: "agent_step",
		runId,
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		text: "thinking",
		toolCalls: [],
	};
}

function errorEvent(
	runId: string,
	branchId: string,
	seq: number,
	message: string,
): CanonicalEvent {
	return {
		kind: "error",
		runId,
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		message,
	};
}

/** Records the store lifecycle call order for assertion. */
function recordingStore(): {
	store: InvestigationStore;
	calls: string[];
	failedWith: string[];
} {
	const calls: string[] = [];
	const failedWith: string[] = [];
	return {
		calls,
		failedWith,
		store: {
			create: async () => {
				calls.push("create");
			},
			append: async (e) => {
				calls.push(`append:${e.kind}`);
			},
			finish: async () => {
				calls.push("finish");
			},
			fail: async (err) => {
				calls.push("fail");
				failedWith.push(err);
			},
			flush: async () => {
				calls.push("flush");
			},
		},
	};
}

function optsWith(harness: HarnessRunner): InvestigateOptions {
	return {
		context: singleAlertContext(alert("HighLatency"), TELEMETRY),
		harness,
		synth: SYNTH,
		runId: "run-1",
	};
}

describe("conductRun — durable lifecycle ordering (ADR-0018)", () => {
	it("errored branch, zero evidence: create → append(per event) → fail, sink sees every event", async () => {
		// Zero tool_results ending in `error` → the stream emits NO report and returns
		// before reduce(): fully hermetic, no LLM. The terminal `error` event makes the
		// outcome failureKind `error` (2026-07-07 honesty fix) — `no-evidence` is
		// reserved for runs that ended cleanly with nothing gathered.
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.runId, ctx.branchId, 0);
			yield errorEvent(ctx.runId, ctx.branchId, 1, "harness branch failed");
		};

		const { store, calls, failedWith } = recordingStore();
		const seen: CanonicalEvent[] = [];

		const outcome = await conductRun(optsWith(harness), {
			sink: (e) => {
				seen.push(e);
			},
			store,
		});

		expect(calls).toEqual([
			"create",
			"append:agent_step",
			"append:error",
			"fail",
		]);
		expect(failedWith).toEqual(["harness branch failed"]);
		expect(seen.map((e) => e.kind)).toEqual(["agent_step", "error"]);
		expect(outcome).toEqual({
			runId: "run-1",
			report: null,
			error: "harness branch failed",
			failureKind: "error",
		});
	});

	it("mid-run harness throw is CONTAINED: one respawn, then a terminal `error` event, then fail", async () => {
		// The N=1 fan-out containment (2026-07-07): a throw AFTER events have flowed
		// gets one bounded respawn, then becomes the branch's terminal `error` event so
		// gathered evidence can still reach reduce() — here there are no tool_results,
		// so no report either way.
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.runId, ctx.branchId, 0);
			throw new Error("transport exploded");
		};

		const { store, calls, failedWith } = recordingStore();
		const seen: CanonicalEvent[] = [];

		const outcome = await conductRun(optsWith(harness), {
			sink: (e) => {
				seen.push(e);
			},
			store,
		});

		expect(calls).toEqual([
			"create",
			"append:agent_step",
			"append:error", // respawn notice
			"append:agent_step",
			"append:error", // terminal
			"fail",
		]);
		expect(failedWith).toEqual(["transport exploded"]);
		expect(seen.map((e) => e.kind)).toEqual([
			"agent_step",
			"error",
			"agent_step",
			"error",
		]);
		expect(outcome).toEqual({
			runId: "run-1",
			report: null,
			error: "transport exploded",
			failureKind: "error",
		});
	});

	it("pre-first-event throw still PROPAGATES: create → fail(error), no events appended", async () => {
		// Setup failures (binary missing, init handshake) have no evidence to salvage —
		// fan-out rethrows and the conductor's catch owns the terminal write.
		// biome-ignore lint/correctness/useYield: throw-only harness stub.
		const harness: HarnessRunner = async function* () {
			throw new Error("spawn deepagents-acp ENOENT");
		};

		const { store, calls, failedWith } = recordingStore();

		const outcome = await conductRun(optsWith(harness), {
			sink: () => {},
			store,
		});

		expect(calls).toEqual(["create", "fail"]);
		expect(failedWith).toEqual(["spawn deepagents-acp ENOENT"]);
		expect(outcome).toEqual({
			runId: "run-1",
			report: null,
			error: "spawn deepagents-acp ENOENT",
			failureKind: "error",
		});
	});
});

describe("conductRun — cooperative cancellation (CANCEL slice, ADR-0018)", () => {
	it("abort mid-stream: consumption stops, the branch generator is returned, resolves cancelled", async () => {
		const controller = new AbortController();
		let branchReturned = false;
		let secondEventPulled = false;

		// A SLOW branch: it yields one event, then would take 10s to produce the next.
		// Aborting after the first event must stop consumption WITHOUT waiting for (or
		// pulling) the second — and its `finally` must run when the generator is returned.
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			try {
				yield agentStep(ctx.runId, ctx.branchId, 0);
				await new Promise((r) => setTimeout(r, 10_000));
				secondEventPulled = true;
				yield agentStep(ctx.runId, ctx.branchId, 1);
			} finally {
				branchReturned = true;
			}
		};

		const { store, calls, failedWith } = recordingStore();
		const seen: CanonicalEvent[] = [];

		const outcome = await conductRun(
			{ ...optsWith(harness), signal: controller.signal },
			{
				// Abort the moment the first event lands — synchronously, so the next loop
				// step short-circuits before pulling the wedged branch again.
				sink: (e) => {
					seen.push(e);
					if (e.kind === "agent_step") controller.abort();
				},
				store,
			},
		);

		await flush();

		expect(outcome).toEqual({
			runId: "run-1",
			report: null,
			error: CANCELLED_MESSAGE,
			failureKind: "cancelled",
		});
		// The slow second event was never consumed; the branch generator was cleaned up.
		expect(secondEventPulled).toBe(false);
		expect(branchReturned).toBe(true);
		// The stream terminated with ONE distinguishable `error` event (no new kind), and
		// the sink saw it — so the live UI renders the cancellation.
		expect(seen.map((e) => e.kind)).toEqual(["agent_step", "error"]);
		expect(seen[1]).toMatchObject({
			kind: "error",
			message: CANCELLED_MESSAGE,
		});
		// The store recorded events and was FLUSHED (draining the buffered tail incl. the
		// terminal CANCELLED `error` event) but was NOT driven to finish/fail on cancel —
		// the caller owns the terminal "cancelled" write (the store has no cancel verb).
		expect(calls).toEqual([
			"create",
			"append:agent_step",
			"append:error",
			"flush",
		]);
		expect(calls).not.toContain("finish");
		expect(calls).not.toContain("fail");
		expect(failedWith).toEqual([]);
	});

	it("a signal that never aborts is inert — a normal errored run is unaffected", async () => {
		const controller = new AbortController();
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.runId, ctx.branchId, 0);
			yield errorEvent(ctx.runId, ctx.branchId, 1, "harness branch failed");
		};
		const { store, calls } = recordingStore();

		const outcome = await conductRun(
			{ ...optsWith(harness), signal: controller.signal },
			{ sink: () => {}, store },
		);

		expect(outcome.failureKind).toBe("error");
		expect(calls).toEqual([
			"create",
			"append:agent_step",
			"append:error",
			"fail",
		]);
	});
});
