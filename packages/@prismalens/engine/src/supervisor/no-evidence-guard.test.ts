/**
 * No-evidence guard (ADR-0002 ordered-evidence / Constitution "no evidence → no
 * report"): a run that gathered ZERO tool_results must emit no report, regardless of
 * how the branch terminated — not just on an `error` terminal. A `branch_done` that
 * never touched a tool is exactly the fabrication risk this guard exists to prevent.
 *
 * Hermetic: the guard in investigateIncidentStream returns BEFORE reduce() (the one
 * supervisor LLM call) ever runs, so this needs no network / no LLM.
 */
import type { CanonicalEvent, FiringAlert } from "@prismalens/contracts";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { HarnessRunner } from "./investigate.js";
import { investigateIncidentStream } from "./investigate.js";

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

function branchDone(
	runId: string,
	branchId: string,
	seq: number,
): CanonicalEvent {
	return {
		kind: "branch_done",
		runId,
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		reason: "submitted",
	};
}

describe("no-evidence guard — any terminal, zero tool_result ⇒ no report", () => {
	it("branch_done with NO tool_result emits no report event", async () => {
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.runId, ctx.branchId, 0);
			yield branchDone(ctx.runId, ctx.branchId, 1);
		};

		const events: CanonicalEvent[] = [];
		for await (const ev of investigateIncidentStream({
			context: singleAlertContext(alert("HighLatency"), TELEMETRY),
			harness,
			synth: SYNTH,
			runId: "run-1",
		})) {
			events.push(ev);
		}

		expect(events.map((e) => e.kind)).toEqual(["agent_step", "branch_done"]);
		expect(events.some((e) => e.kind === "report")).toBe(false);
	});
});
