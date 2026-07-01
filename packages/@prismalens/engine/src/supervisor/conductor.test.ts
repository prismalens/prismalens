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
import type { HarnessRunner, InvestigateOptions } from "./investigate.js";

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
	it("no-evidence branch: create → append(per event) → fail, sink sees every event", async () => {
		// Zero tool_results ending in `error` → the stream emits NO report and returns
		// before reduce(): fully hermetic, no LLM.
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
			failureKind: "no-evidence",
		});
	});

	it("thrown harness error: create → fail(error), returns failureKind 'error'", async () => {
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

		expect(calls).toEqual(["create", "append:agent_step", "fail"]);
		expect(failedWith).toEqual(["transport exploded"]);
		expect(seen.map((e) => e.kind)).toEqual(["agent_step"]);
		expect(outcome).toEqual({
			runId: "run-1",
			report: null,
			error: "transport exploded",
			failureKind: "error",
		});
	});
});
