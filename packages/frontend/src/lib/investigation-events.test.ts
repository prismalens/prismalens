// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	agentStepMessage,
	deriveStreamView,
	deriveTranscript,
	latestAgentText,
	pinnedTo,
} from "./investigation-events";

const RUN_ID = "00000000-0000-0000-0000-000000000001";

/**
 * A report the contract actually accepts. The fixtures here used to be
 * `{summary, hypotheses}` — which `InvestigationReportSchema` rejects, and
 * which is precisely the shape the old duck-typed check hid by mistake.
 */
const VALID_REPORT = {
	summary: "pool saturated",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
	nextSteps: [],
};

function agentStep(branchId: string, seq: number, text: string): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: RUN_ID,
		branchId,
		path: [],
		seq,
		label: null,
		text,
		toolCalls: [],
		ts: "2026-08-22T00:00:00Z",
	};
}

function report(seq: number): CanonicalEvent {
	return {
		kind: "report",
		runId: RUN_ID,
		seq,
		ts: "2026-08-22T00:00:00Z",
		report: {
			summary: "checkout-api saturated its connection pool",
			rootCause: null,
			rootCauseCategory: null,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: [], notQueried: [] },
			nextSteps: [],
		},
	};
}

describe("deriveStreamView", () => {
	it("treats no events as a single flat, empty list", () => {
		const view = deriveStreamView([]);

		expect(view.isMultiBranch).toBe(false);
		expect(view.flatRows).toEqual([]);
	});

	it("renders one 'root' branch flat, report row last", () => {
		const view = deriveStreamView([
			agentStep("root", 0, "Mapping services"),
			report(1),
		]);

		expect(view.isMultiBranch).toBe(false);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			"Mapping services",
			"Report ready",
		]);
	});

	// The first branch of a live fan-out is emitted alone before its siblings.
	it("renders one 'b0' branch flat — a first branch is not yet a fan-out", () => {
		const view = deriveStreamView([agentStep("b0", 0, "Mapping services")]);

		expect(view.isMultiBranch).toBe(false);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			"Mapping services",
		]);
	});

	// A cancelled run's terminal event carries branchId "supervisor".
	it("renders one 'supervisor' branch flat", () => {
		const view = deriveStreamView([
			agentStep("supervisor", 0, "Cancelling investigation"),
		]);

		expect(view.isMultiBranch).toBe(false);
		expect(view.flatRows).toHaveLength(1);
	});

	it("switches to per-branch grouping once a second branch appears", () => {
		const view = deriveStreamView([
			agentStep("b0", 0, "Mapping services"),
			agentStep("b1", 0, "Correlating deploys"),
			report(1),
		]);

		expect(view.isMultiBranch).toBe(true);
		expect(view.flatRows).toEqual([]);
		expect(view.branches.map((branch) => branch.branchId)).toEqual([
			"b0",
			"b1",
		]);
		expect(view.reportRows.map((row) => row.message)).toEqual(["Report ready"]);
	});

	it("names the drafted report instead of printing its JSON, fenced or bare", () => {
		const json = JSON.stringify(VALID_REPORT);
		const view = deriveStreamView([
			agentStep("main", 1, "Reading the workers next."),
			agentStep("main", 2, json),
			agentStep("main", 3, `\`\`\`json\n${json}\n\`\`\``),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			"Reading the workers next.",
			"Report drafted",
			"Report drafted",
		]);
	});

	it("names the drafted report when prose precedes its JSON (#659)", () => {
		const json = JSON.stringify(VALID_REPORT, null, 2);
		const view = deriveStreamView([
			agentStep("main", 1, `The pool ran dry.\n\n\`\`\`json\n${json}\n\`\`\`\n`),
			agentStep("main", 2, `Final report follows.\n${json}`),
			agentStep("main", 3, "Checked {config} and ```bash\nls\n``` output."),
			report(4),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			"Report drafted",
			"Report drafted",
			"Checked {config} and ```bash\nls\n``` output.",
			"Report ready",
		]);
	});

	it("keeps JSON that is not the report visible", () => {
		const config = 'Config:\n{"retries":3}';
		const fenced = '```json\n{"status":"ok"}\n```';
		const view = deriveStreamView([
			agentStep("main", 1, config),
			agentStep("main", 2, fenced),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([config, fenced]);
	});

	/**
	 * The counter-example from the #660 review. The old check asked only for a
	 * string `summary` and an array `hypotheses`, so this object — which the
	 * report schema rejects — was silently replaced by "Report drafted" and the
	 * agent's text was lost.
	 */
	it("keeps an object that merely LOOKS report-shaped visible", () => {
		const lookalike = JSON.stringify({
			summary: "what I am about to do",
			hypotheses: ["check the pool", "check the workers"],
		});
		const fenced = `\`\`\`json\n${lookalike}\n\`\`\``;
		const view = deriveStreamView([
			agentStep("main", 1, lookalike),
			agentStep("main", 2, fenced),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			lookalike,
			fenced,
		]);
	});

	/**
	 * Characterisation, not a regression: `summary` and `hypotheses` are both
	 * schema-required, so the old check never rejected a real report — it was
	 * strictly looser than the contract. This pins the other direction shut, so
	 * a later tightening cannot start printing reports raw.
	 */
	it("hides a real report that omits every optional field", () => {
		const json = JSON.stringify(VALID_REPORT);
		const view = deriveStreamView([agentStep("main", 1, json)]);
		expect(view.flatRows.map((row) => row.message)).toEqual(["Report drafted"]);
	});

	it("hides a report carrying the host-stamped fidelity field too", () => {
		// `ModelReportSchema` omits `fidelity`; the stamped report has it. One
		// schema has to accept both, and this is the half the model never writes.
		// Also characterisation — it guards the choice of schema, not the bug.
		const json = JSON.stringify({ ...VALID_REPORT, fidelity: null });
		const view = deriveStreamView([agentStep("main", 1, json)]);
		expect(view.flatRows.map((row) => row.message)).toEqual(["Report drafted"]);
	});

	/**
	 * A bare fragment is SHOWN: it is indistinguishable from prose starting
	 * with `{`. A message sent mid-turn does cut a report off, though, and an
	 * unclosed ```json block opening with "summary" reads as one line (#673 walk 4).
	 */
	it("shows a bare report fragment and names a cut-off fenced one", () => {
		const whole = JSON.stringify(VALID_REPORT, null, 2);
		const head = whole.slice(0, Math.floor(whole.length / 2));
		const view = deriveStreamView([
			agentStep("main", 1, head),
			agentStep("main", 2, `\`\`\`json\n${head}`),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			head,
			"Report draft cut off",
		]);
	});

	it("hides the report once the final chunk completes it", () => {
		const whole = JSON.stringify(VALID_REPORT, null, 2);
		const view = deriveStreamView([
			agentStep("main", 1, whole.slice(0, 20)),
			agentStep("main", 2, whole),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			whole.slice(0, 20),
			"Report drafted",
		]);
	});

	it("hides a fenced report with CRLF line endings", () => {
		const json = JSON.stringify(VALID_REPORT);
		const view = deriveStreamView([
			agentStep("main", 1, `Done.\r\n\`\`\`json\r\n${json}\r\n\`\`\`\r\n`),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual(["Report drafted"]);
	});

	it("hides a fenced report whose strings contain a backtick fence", () => {
		const json = JSON.stringify(
			{ ...VALID_REPORT, summary: "ran ```kubectl get pods``` twice" },
			null,
			2,
		);
		const view = deriveStreamView([
			agentStep("main", 1, `Done.\n\`\`\`json\n${json}\n\`\`\``),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual(["Report drafted"]);
	});

	// The badge only ever prints "N branches", so N is never 1.
	it("never reports a multi-branch view with a single branch", () => {
		for (const branchId of ["root", "b0", "supervisor"]) {
			const view = deriveStreamView([agentStep(branchId, 0, "step")]);
			expect(view.branches).toHaveLength(1);
			expect(view.isMultiBranch).toBe(false);
		}
	});
});

describe("a report cut off mid-block (#673 walk 4)", () => {
	const walkShape =
		"```json\n{\n  \"summary\": \"The 'CodexProbe' alert ...\",\n  \"coverage\": {\n    \"queried\": [\n      \"sum(rate(flask_http_request_total{job='booklogr-api',status=~'";

	it("agentStepMessage: the walk shape returns 'Report draft cut off' (#673 walk 4)", () => {
		expect(agentStepMessage(walkShape)).toBe("Report draft cut off");
	});

	it("agentStepMessage: prose line followed by an unclosed json block starting with summary returns 'Report draft cut off' (#673 walk 4)", () => {
		const text = `Working on the report.\n\n\`\`\`json\n{\n  "summary": "The alert fired",\n  "hypotheses": [`;
		expect(agentStepMessage(text)).toBe("Report draft cut off");
	});

	it("agentStepMessage: an unclosed bare fence starting with summary returns 'Report draft cut off' (#673 walk 4)", () => {
		const text = "```\n{\n  \"summary\": \"The alert fired\",\n  \"hypotheses\": [";
		expect(agentStepMessage(text)).toBe("Report draft cut off");
	});

	it("agentStepMessage: unclosed json block starting with another key is returned unchanged (#673 walk 4)", () => {
		const text = "```json\n{\n  \"plan\": \"check the database\",\n  \"steps\": [";
		expect(agentStepMessage(text)).toBe(text);
	});

	it("agentStepMessage: a closed json block starting with summary that fails schema is returned unchanged (#673 walk 4)", () => {
		const text = "```json\n{\n  \"summary\": \"just a summary with no other schema fields\"\n}\n```";
		expect(agentStepMessage(text)).toBe(text);
	});

	it("deriveTranscript: walk shape followed by operator messages gives a line item and no prose item containing json fence (#673 walk 4)", () => {
		const events: CanonicalEvent[] = [
			agentStep("main", 1, walkShape),
			{
				kind: "operator_message",
				runId: RUN_ID,
				branchId: "main",
				path: [],
				seq: 2,
				label: null,
				ts: "2026-08-22T00:00:01Z",
				text: "queued follow-up",
				mode: "queue",
				delivered: true,
			},
			{
				kind: "operator_message",
				runId: RUN_ID,
				branchId: "main",
				path: [],
				seq: 3,
				label: null,
				ts: "2026-08-22T00:00:02Z",
				text: "immediate follow-up",
				mode: "now",
				delivered: true,
			},
		];
		const items = deriveTranscript(events, Date.parse("2026-08-22T00:00:03Z"), {
			run: { status: "completed", live: false },
		});
		expect(items).toContainEqual(
			expect.objectContaining({
				kind: "line",
				text: "Report draft cut off",
			}),
		);
		const proseWithJson = items.filter(
			(i) => i.kind === "prose" && i.text.includes("```json"),
		);
		expect(proseWithJson).toHaveLength(0);
	});

	it("latestAgentText: skips a cut-off report step and returns the newest real prose (#673 walk 4)", () => {
		const events: CanonicalEvent[] = [
			agentStep("main", 1, "Checked the pool."),
			agentStep("main", 2, walkShape),
		];
		expect(latestAgentText(events)).toBe("Checked the pool.");
	});
});

describe("pinnedTo for newer-run line (#673 w27)", () => {
	it("returns undefined when workspace is missing or has no repos", () => {
		expect(pinnedTo(undefined)).toBeUndefined();
		expect(pinnedTo(null)).toBeUndefined();
		expect(pinnedTo({ repos: [] })).toBeUndefined();
	});

	it("derives sha7 for a single repo", () => {
		expect(
			pinnedTo({ repos: [{ name: "frontend", head: "1234567890abcdef" }] }),
		).toBe("1234567");
	});

	it("derives repo names and short shas for multiple repos", () => {
		expect(
			pinnedTo({
				repos: [
					{ name: "api", head: "1a2b3c4d5e6f" },
					{ name: "worker", head: "5d6e7f8a9b0c" },
				],
			}),
		).toBe("api@1a2b3c4, worker@5d6e7f8");
	});
});

