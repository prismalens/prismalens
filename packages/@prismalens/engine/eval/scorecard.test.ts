/**
 * Hermetic tests for the golden-incident scorecard's OFFLINE plumbing (Phase B.3
 * pulled-forward eval slice): fixtures schema-parse into real contracts types, the
 * scoring function's pass/fail logic, and the threshold arithmetic. NO network, NO
 * LLM — mirrors the stub-model pattern in `supervisor/map-reduce.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures.js";
import { meetsThreshold, scoreReport } from "./score.js";

const FIXTURE_COUNT = 5;

describe("golden-incident fixtures", () => {
	it("loads and schema-validates all 5 fixtures", () => {
		const fixtures = loadFixtures();
		expect(fixtures).toHaveLength(FIXTURE_COUNT);
		for (const fx of fixtures) {
			expect(fx.name).toBeTruthy();
			expect(fx.context.alerts.length).toBeGreaterThanOrEqual(1);
			expect(fx.transcriptEvents.length).toBeGreaterThan(0);
			expect(fx.expected.rootCauseKeywords.length).toBeGreaterThan(0);
		}
	});

	it("are diverse (distinct fixture names, one alert focus each)", () => {
		const fixtures = loadFixtures();
		const names = new Set(fixtures.map((fx) => fx.name));
		expect(names.size).toBe(FIXTURE_COUNT);
	});

	it("every transcript's tool_results carry non-empty diagnostic previews", () => {
		const fixtures = loadFixtures();
		for (const fx of fixtures) {
			const toolResults = fx.transcriptEvents.filter(
				(e) => e.kind === "tool_result",
			);
			expect(toolResults.length).toBeGreaterThan(0);
			for (const ev of toolResults) {
				if (ev.kind === "tool_result") {
					expect(ev.result.preview.trim().length).toBeGreaterThan(0);
				}
			}
		}
	});
});

function report(topHypothesis: string | null, rootCause: string | null = null) {
	return {
		summary: "s",
		rootCause,
		rootCauseCategory: null,
		hypotheses: topHypothesis
			? [
					{
						statement: topHypothesis,
						status: "supported" as const,
						evidence: [],
					},
				]
			: [],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [],
	};
}

describe("scoreReport", () => {
	const expected = {
		rootCauseKeywords: ["connection pool", "pool exhaustion"],
		mustNotContain: ["autoscaling"],
	};

	it("passes when the top hypothesis contains an expected keyword", () => {
		const result = scoreReport(
			report("Connection pool exhaustion on orders-api"),
			expected,
		);
		expect(result.pass).toBe(true);
		expect(result.matchedKeyword).toBe("connection pool");
	});

	it("matches case-insensitively", () => {
		const result = scoreReport(report("CONNECTION POOL saturated"), expected);
		expect(result.pass).toBe(true);
	});

	it("falls back to rootCause when there are no hypotheses", () => {
		const result = scoreReport(
			report(null, "connection pool exhaustion"),
			expected,
		);
		expect(result.pass).toBe(true);
	});

	it("fails when no expected keyword is present", () => {
		const result = scoreReport(report("disk full on the node"), expected);
		expect(result.pass).toBe(false);
		expect(result.matchedKeyword).toBeNull();
	});

	it("fails when a mustNotContain string is present, even alongside a match", () => {
		const result = scoreReport(
			report("connection pool exhaustion caused by autoscaling lag"),
			expected,
		);
		expect(result.pass).toBe(false);
		expect(result.violatedMustNotContain).toBe("autoscaling");
	});

	it("fails on an empty report (no hypotheses, no rootCause)", () => {
		const result = scoreReport(report(null), expected);
		expect(result.pass).toBe(false);
		expect(result.topHypothesis).toBe("");
	});
});

describe("meetsThreshold", () => {
	it("passes at exactly the threshold", () => {
		expect(meetsThreshold(4, 5, 4)).toBe(true);
	});

	it("fails below the threshold", () => {
		expect(meetsThreshold(3, 5, 4)).toBe(false);
	});

	it("passes above the threshold", () => {
		expect(meetsThreshold(5, 5, 4)).toBe(true);
	});

	it("never passes with zero fixtures, regardless of threshold", () => {
		expect(meetsThreshold(0, 0, 0)).toBe(false);
	});
});
