// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { makeKeywordOracle } from "./interim-oracle.js";
import type { ArmCapture } from "./ab-runner.js";

describe("interim path-A keyword oracle", () => {
	const keywords = ["pool_size", "connection pool", "sqlalchemy"];
	const oracle = makeKeywordOracle(keywords);

	const dummyContext = {
		alerts: [],
		telemetry: { prometheusUrl: "", alertmanagerUrl: "", apiUrl: "" },
	};

	function createRawArm(rawText: string): Omit<ArmCapture, "score"> {
		return {
			arm: "raw",
			rawText,
			report: { rawText },
			costUsd: 0,
			providerCost: { claudeUsd: 0 },
			tokens: { input: 0, output: 0 },
			timeToReportMs: 0,
			alertSnapshot: {},
			events: [],
		};
	}

	function createPrismalensArm(topHypothesis: string): Omit<ArmCapture, "score"> {
		return {
			arm: "prismalens",
			rawText: "not scored for prismalens arm",
			report: {
				summary: "test",
				rootCause: null,
				rootCauseCategory: null,
				hypotheses: [
					{
						statement: topHypothesis,
						status: "supported",
						evidence: [],
					},
				],
				ruledOut: [],
				coverage: { queried: [], notQueried: [] },
				nextSteps: [],
			},
			costUsd: 0,
			providerCost: { claudeUsd: 0 },
			tokens: { input: 0, output: 0 },
			timeToReportMs: 0,
			alertSnapshot: {},
			events: [],
		};
	}

	describe("raw arm", () => {
		it("scores high (1) for correct RCA text", async () => {
			const arm = createRawArm(
				"The issue is that the connection pool was exhausted due to pool_size being 1.",
			);
			const score = await oracle(arm, dummyContext);
			expect(score.score).toBe(1);
			expect(score.note).toContain("matched: pool_size");
		});

		it("scores low (0) for decoy-style text", async () => {
			const arm = createRawArm(
				"The new deploy broke the app, we should roll it back. NullCache is being used.",
			);
			const score = await oracle(arm, dummyContext);
			expect(score.score).toBe(0);
			expect(score.note).toContain("matched: none");
		});
	});

	describe("prismalens arm", () => {
		it("scores high (1) for correct RCA hypothesis", async () => {
			const arm = createPrismalensArm(
				"Deploy reduced sqlalchemy_engine_options which starved workers.",
			);
			const score = await oracle(arm, dummyContext);
			expect(score.score).toBe(1);
			expect(score.note).toContain("matched: sqlalchemy");
		});

		it("scores low (0) for decoy-style hypothesis", async () => {
			const arm = createPrismalensArm(
				"The latest commit introduced a regression with the cache backend.",
			);
			const score = await oracle(arm, dummyContext);
			expect(score.score).toBe(0);
			expect(score.note).toContain("matched: none");
		});
	});

	it("includes superseded note", async () => {
		const arm = createRawArm("blah");
		const score = await oracle(arm, dummyContext);
		expect(score.note).toContain("interim path-A keyword scorer (superseded by #56)");
	});
});
