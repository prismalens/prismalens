// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { deriveStreamView } from "./investigation-events";

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
	 * Partial text does not reach this path — `AcpAdapter` accumulates the ACP
	 * deltas and flushes one complete turn per `agent_step` — but if a harness
	 * ever split a report, the fragment is SHOWN, not swallowed. An unparseable
	 * fragment is indistinguishable from prose starting with `{`, and losing the
	 * agent's words is the worse failure.
	 */
	it("shows an incomplete report fragment rather than hiding it", () => {
		const whole = JSON.stringify(VALID_REPORT, null, 2);
		const head = whole.slice(0, Math.floor(whole.length / 2));
		const view = deriveStreamView([
			agentStep("main", 1, head),
			agentStep("main", 2, `\`\`\`json\n${head}`),
		]);
		expect(view.flatRows.map((row) => row.message)).toEqual([
			head,
			`\`\`\`json\n${head}`,
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
