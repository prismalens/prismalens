/**
 * Hermetic tests for the reduce step's map-reduce (ADR-0016 decision 2 / critique C3).
 * No network / no LLM — reduce() takes an INJECTABLE ReportModel, so a stub records
 * every prompt + call count and returns canned reports. That lets us assert the
 * ORCHESTRATION (how many model calls, which branches map, whether a merge runs, what
 * the merge sees) without a live synthesis call.
 *
 * The all-branches-empty ⇒ no-report case is a RUN-level guard tested against
 * investigateIncidentStream (it returns before reduce()), so it lives here too.
 */
import type {
	CanonicalEvent,
	FiringAlert,
	InvestigationContext,
	InvestigationReport,
} from "@prismalens/contracts";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { HarnessRunner } from "./investigate.js";
import { investigateIncidentStream } from "./investigate.js";
import { type ReportModel, reduce } from "./synthesize.js";

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

function multiAlertContext(names: string[]): InvestigationContext {
	return {
		...singleAlertContext(alert(names[0]), TELEMETRY),
		alerts: names.map(alert),
	};
}

function report(summary: string, hypothesis?: string): InvestigationReport {
	return {
		summary,
		rootCause: null,
		rootCauseCategory: null,
		hypotheses: hypothesis
			? [{ statement: hypothesis, status: "supported", evidence: [] }]
			: [],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [],
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

const MERGE_MARKER = "=== PER-BRANCH REPORTS ===";

/**
 * Stub ReportModel: returns per-branch reports in call order for synthesis prompts,
 * and a fixed `merged` report for the one merge prompt. Records every prompt so a
 * test can assert call count + what the merge call was fed.
 */
function stubModel(
	perBranch: InvestigationReport[],
	merged: InvestigationReport,
) {
	const prompts: string[] = [];
	let synthIdx = 0;
	const model: ReportModel = async (prompt) => {
		prompts.push(prompt);
		if (prompt.includes(MERGE_MARKER)) return merged;
		return perBranch[synthIdx++] ?? perBranch.at(-1) ?? report("fallback");
	};
	return { model, prompts };
}

describe("reduce — map-reduce (ADR-0016 decision 2)", () => {
	it("N=1 short-circuits to EXACTLY one synthesis call (no merge)", async () => {
		const events = [agentStep("root", 0), toolResult("root", 1)];
		const single = report("single-branch report");
		const { model, prompts } = stubModel([single], report("unused-merge"));

		const out = await reduce(
			singleAlertContext(alert("HighLatency"), TELEMETRY),
			events,
			SYNTH,
			model,
		);

		expect(prompts).toHaveLength(1); // one model call, no extra LLM cost
		expect(prompts[0]).not.toContain(MERGE_MARKER); // it's a synthesis, not a merge
		expect(out).toEqual(single);
	});

	it("N>1 maps each non-empty branch then merges (dedupe/rank) in ONE further call", async () => {
		const events = [
			agentStep("b0", 0),
			toolResult("b0", 1),
			agentStep("b1", 0),
			toolResult("b1", 1),
		];
		const perBranch = [
			report("branch-A summary", "shared cause"),
			report("branch-B summary", "shared cause"),
		];
		const merged = report("consolidated summary", "shared cause");
		const { model, prompts } = stubModel(perBranch, merged);

		const out = await reduce(
			multiAlertContext(["A", "B"]),
			events,
			SYNTH,
			model,
		);

		// map (2 per-branch synth) + reduce (1 merge) = 3 model calls.
		expect(prompts).toHaveLength(3);
		expect(prompts[0]).not.toContain(MERGE_MARKER);
		expect(prompts[1]).not.toContain(MERGE_MARKER);
		// Each branch's map transcript names ITS OWN focus alert as the firing alert
		// (ADR-0016 decision 2) — labelling b1's evidence with alerts[0] would defeat
		// per-alert fan-out (review blocker, 2026-07-05).
		expect(prompts[0]).toContain("FIRING ALERT: A");
		expect(prompts[0]).toContain("related alerts: B");
		expect(prompts[1]).toContain("FIRING ALERT: B");
		expect(prompts[1]).toContain("related alerts: A");
		// The merge call is fed BOTH per-branch reports (so it can dedupe/unite).
		expect(prompts[2]).toContain(MERGE_MARKER);
		expect(prompts[2]).toContain("branch-A summary");
		expect(prompts[2]).toContain("branch-B summary");
		expect(prompts[2]).toContain("shared cause");
		expect(out).toEqual(merged);
	});

	it("excludes a zero-evidence branch from the map (single survivor ⇒ no merge)", async () => {
		// b0 has a tool_result; b1 gathered nothing. Only b0 maps, and one survivor
		// needs no merge — so exactly one model call, and it is a synthesis.
		const events = [
			agentStep("b0", 0),
			toolResult("b0", 1),
			agentStep("b1", 0), // b1: no tool_result → excluded
		];
		const survivor = report("only-b0 report");
		const { model, prompts } = stubModel([survivor], report("unused-merge"));

		const out = await reduce(
			multiAlertContext(["A", "B"]),
			events,
			SYNTH,
			model,
		);

		expect(prompts).toHaveLength(1);
		expect(prompts[0]).not.toContain(MERGE_MARKER);
		expect(out).toEqual(survivor);
	});

	it("ALL branches empty ⇒ no report (run-level guard, reduce never runs)", async () => {
		// Two branches, neither emits a tool_result → investigateIncidentStream's
		// run-level no-evidence guard returns before reduce(): no `report` event, and
		// the real (default) reduce model is never touched — fully hermetic.
		const harness: HarnessRunner = async function* (_prompt, ctx) {
			yield agentStep(ctx.branchId, 0);
		};

		const emitted: CanonicalEvent[] = [];
		for await (const ev of investigateIncidentStream({
			context: multiAlertContext(["A", "B"]),
			harness,
			synth: SYNTH,
			runId: "run-1",
		})) {
			emitted.push(ev);
		}

		expect(emitted.some((e) => e.kind === "tool_result")).toBe(false);
		expect(emitted.some((e) => e.kind === "report")).toBe(false);
	});
});
