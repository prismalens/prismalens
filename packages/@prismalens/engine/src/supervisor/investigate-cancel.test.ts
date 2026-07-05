/**
 * Hermetic tests for the terminal-reduce() abort guards (CANCEL slice, ADR-0018): an
 * abort that lands AFTER the merged stream drains — where the drive-loop can no longer
 * observe it — must still resolve a cancelled run, NOT a report. Two windows:
 *   (a) between drain and reduce()  → reduce is never called, no report;
 *   (b) during reduce()             → the result is discarded, no report.
 * No network / no LLM — the reduce model is injected via `opts.model`, and the abort is
 * driven deterministically (a fake signal for (a), so the loop's step-race never sees it;
 * a real controller aborted from inside the model for (b)).
 */
import type {
	CanonicalEvent,
	FiringAlert,
	InvestigationReport,
} from "@prismalens/contracts";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	CANCELLED_MESSAGE,
	type HarnessRunner,
	investigateIncidentStream,
} from "./investigate.js";
import type { ReportModel } from "./synthesize.js";

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

function agentStep(branchId: string, seq: number): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: "run-1",
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		text: "thinking",
		toolCalls: [],
	};
}

function toolResult(branchId: string, seq: number): CanonicalEvent {
	return {
		kind: "tool_result",
		runId: "run-1",
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		result: {
			name: "curl",
			toolCallId: `${branchId}-${seq}`,
			source: "curl prom",
			ok: true,
			preview: "value 42",
		},
	};
}

function report(summary: string): InvestigationReport {
	return {
		summary,
		rootCause: null,
		rootCauseCategory: null,
		hypotheses: [],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [],
	};
}

async function collect(
	gen: AsyncGenerator<CanonicalEvent>,
): Promise<CanonicalEvent[]> {
	const out: CanonicalEvent[] = [];
	for await (const ev of gen) out.push(ev);
	return out;
}

describe("investigateIncidentStream — abort around terminal reduce() (ADR-0018)", () => {
	it("(a) abort between drain and reduce: reduce is never called, cancelled terminal, no report", async () => {
		// A harness that produces real evidence then drains cleanly. The fake signal's
		// `aborted` flag flips to true as the generator returns done — the drive-loop's
		// step-race (which reads `aborted` at the START of each pull) has already passed,
		// and the fake never dispatches an `abort` event, so the loop observes `done`, not
		// `aborted`. That lands the run at the pre-reduce guard with `aborted === true` —
		// exactly the "drained, then aborted" window (deterministic, no timing race).
		let aborted = false;
		const signal = {
			get aborted() {
				return aborted;
			},
			addEventListener() {},
			removeEventListener() {},
		} as unknown as AbortSignal;

		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.branchId, 0);
			yield toolResult(ctx.branchId, 1);
			// Flips as the generator completes (its final next() returns done); the loop's
			// early `aborted` check for that pull already read false.
			aborted = true;
		};

		const model = vi.fn<ReportModel>(async () => report("must-not-run"));

		const events = await collect(
			investigateIncidentStream({
				context: singleAlertContext(alert("HighLatency"), TELEMETRY),
				harness,
				synth: SYNTH,
				runId: "run-1",
				signal,
				model,
			}),
		);

		expect(model).not.toHaveBeenCalled();
		expect(events.some((e) => e.kind === "report")).toBe(false);
		const last = events.at(-1);
		expect(last).toMatchObject({ kind: "error", message: CANCELLED_MESSAGE });
	});

	it("(b) abort during reduce: the synthesized report is discarded, cancelled terminal, no report", async () => {
		const controller = new AbortController();

		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.branchId, 0);
			yield toolResult(ctx.branchId, 1);
		};

		// The model stands in for the (non-abortable) supervisor LLM call: it aborts the
		// run mid-synthesis and still returns a report — which the post-reduce guard must
		// discard. Aborting here is safe/deterministic: the drive-loop has already drained
		// and detached its abort listener, so this cannot re-enter the mid-stream path.
		const model = vi.fn<ReportModel>(async () => {
			controller.abort();
			return report("discarded");
		});

		const events = await collect(
			investigateIncidentStream({
				context: singleAlertContext(alert("HighLatency"), TELEMETRY),
				harness,
				synth: SYNTH,
				runId: "run-1",
				signal: controller.signal,
				model,
			}),
		);

		expect(model).toHaveBeenCalledTimes(1);
		expect(events.some((e) => e.kind === "report")).toBe(false);
		const last = events.at(-1);
		expect(last).toMatchObject({ kind: "error", message: CANCELLED_MESSAGE });
	});

	it("no abort: a normal run still reaches reduce and yields the report (guards are inert)", async () => {
		const controller = new AbortController();
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.branchId, 0);
			yield toolResult(ctx.branchId, 1);
		};
		const model = vi.fn<ReportModel>(async () => report("clean report"));

		const events = await collect(
			investigateIncidentStream({
				context: singleAlertContext(alert("HighLatency"), TELEMETRY),
				harness,
				synth: SYNTH,
				runId: "run-1",
				signal: controller.signal,
				model,
			}),
		);

		expect(model).toHaveBeenCalledTimes(1);
		const reportEvent = events.find((e) => e.kind === "report");
		expect(reportEvent).toBeDefined();
	});
});
