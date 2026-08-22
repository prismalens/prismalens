// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { deriveStreamView } from "./investigation-events";

const RUN_ID = "00000000-0000-0000-0000-000000000001";

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

	// The badge only ever prints "N branches", so N is never 1.
	it("never reports a multi-branch view with a single branch", () => {
		for (const branchId of ["root", "b0", "supervisor"]) {
			const view = deriveStreamView([agentStep(branchId, 0, "step")]);
			expect(view.branches).toHaveLength(1);
			expect(view.isMultiBranch).toBe(false);
		}
	});
});
