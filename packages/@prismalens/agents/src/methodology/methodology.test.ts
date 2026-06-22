import { describe, expect, it } from "vitest";
import {
	classifyConfidence,
	corroborationSatisfied,
	requiresCorroboration,
} from "./confidence.js";
import { isNewInformation, type ProgressSnapshot } from "./convergence.js";
import { asFindingId, type Finding, type Hypothesis } from "./findings.js";
import { deriveBand, type InvestigationReport } from "./report.js";
import { gradeReport } from "./rubric.js";

/** Build a Finding with sane required defaults. */
function f(
	id: string,
	type: Finding["type"],
	opts: { source?: string; relatedTo?: string; confidence?: number } = {},
): Finding {
	return {
		id: asFindingId(id),
		type,
		description: id,
		agentId: "agent-1",
		timestamp: "2026-01-01T00:00:00Z",
		...(opts.source ? { source: opts.source } : {}),
		...(opts.relatedTo ? { relatedTo: asFindingId(opts.relatedTo) } : {}),
		...(opts.confidence !== undefined ? { confidence: opts.confidence } : {}),
	};
}

/** Build a Hypothesis with sane required defaults. */
function h(over: Partial<Hypothesis> & Pick<Hypothesis, "id">): Hypothesis {
	return {
		statement: over.id,
		status: "testing",
		confidence: 0.8,
		supportingEvidence: [],
		contradictingEvidence: [],
		iteration: 1,
		...over,
	};
}

/** Build an InvestigationReport; coverage defaults to "recorded" to isolate gaps. */
function makeReport(
	over: Partial<InvestigationReport> = {},
): InvestigationReport {
	const confidence = over.confidence ?? 0;
	return {
		summary: "",
		confidence,
		band: deriveBand({ confidence }),
		hypotheses: [],
		findings: [],
		recommendations: [],
		coverage: { sourcesQueried: ["prometheus"], dataGaps: [], completeness: 1 },
		ruledOut: [],
		...over,
	};
}

describe("confidence band (FR-5/6/7)", () => {
	it("classifies at the band boundaries", () => {
		expect(classifyConfidence(0.85)).toBe("auto");
		expect(classifyConfidence(0.849)).toBe("corroborate");
		expect(classifyConfidence(0.7)).toBe("corroborate");
		expect(classifyConfidence(0.699)).toBe("reject");
	});

	it("requiresCorroboration only inside [0.7, 0.85)", () => {
		expect(requiresCorroboration(0.7)).toBe(true);
		expect(requiresCorroboration(0.84)).toBe(true);
		expect(requiresCorroboration(0.85)).toBe(false);
		expect(requiresCorroboration(0.69)).toBe(false);
	});

	it("corroboration needs >=2 DISTINCT sources, not 2 findings (FR-7)", () => {
		const hyp = h({
			id: "hyp-1",
			supportingEvidence: [asFindingId("f1"), asFindingId("f2")],
		});
		const sameSource = [
			f("f1", "evidence", { source: "prometheus" }),
			f("f2", "evidence", { source: "prometheus" }),
		];
		const twoSources = [
			f("f1", "evidence", { source: "prometheus" }),
			f("f2", "evidence", { source: "sentry" }),
		];
		expect(corroborationSatisfied(hyp, sameSource)).toBe(false);
		expect(corroborationSatisfied(hyp, twoSources)).toBe(true);
	});
});

describe("gradeReport — SC-4: un-evidenced conclusion fails", () => {
	it("a stated rootCause with no linked root_cause finding fails, even if an unrelated hypothesis has evidence", () => {
		const report = makeReport({
			rootCause: "disk full",
			confidence: 0.9,
			// an unrelated, fully-evidenced hypothesis must NOT rescue the bare string
			hypotheses: [
				h({
					id: "hyp-1",
					status: "supported",
					confidence: 0.9,
					supportingEvidence: [asFindingId("f1")],
				}),
			],
			findings: [f("f1", "evidence", { source: "prometheus" })],
		});
		const result = gradeReport(report);
		expect(result.pass).toBe(false);
		expect(
			result.gaps.some((g) => g.criterion === "conclusion-evidence-linked"),
		).toBe(true);
	});

	it("a root_cause finding with no supporting finding fails (NFR-2)", () => {
		const report = makeReport({
			confidence: 0.9,
			findings: [f("rc-1", "root_cause", { source: "prometheus" })],
		});
		const result = gradeReport(report);
		expect(
			result.gaps.some((g) => g.criterion === "conclusion-evidence-linked"),
		).toBe(true);
	});

	it("a properly evidence-linked root cause passes clean", () => {
		const report = makeReport({
			rootCause: "connection pool exhaustion",
			confidence: 0.9,
			findings: [
				f("rc-1", "root_cause", { source: "prometheus" }),
				f("ev-1", "evidence", { source: "prometheus", relatedTo: "rc-1" }),
			],
		});
		const result = gradeReport(report);
		expect(result.pass).toBe(true);
		expect(result.signal).toBeNull();
		expect(result.score).toBe(1);
	});
});

describe("gradeReport — SC-5: negative signal only, never a kill", () => {
	it("a gap in the reject band yields a 'stalled' signal", () => {
		const report = makeReport({ rootCause: "x", confidence: 0.5 });
		const result = gradeReport(report);
		expect(result.pass).toBe(false);
		expect(result.signal).not.toBeNull();
		expect(result.signal?.type).toBe("stalled");
	});

	it("a gap with in-band confidence yields a 'converged' signal", () => {
		const report = makeReport({ rootCause: "x", confidence: 0.9 });
		const result = gradeReport(report);
		expect(result.pass).toBe(false);
		expect(result.signal?.type).toBe("converged");
	});

	it("never throws on a minimal/empty report", () => {
		expect(() => gradeReport(makeReport())).not.toThrow();
	});

	it("flags a corroborate-band hypothesis lacking 2 sources", () => {
		const report = makeReport({
			confidence: 0.8,
			hypotheses: [
				h({
					id: "hyp-1",
					confidence: 0.8,
					supportingEvidence: [asFindingId("f1"), asFindingId("f2")],
					contradictingEvidence: [asFindingId("c1")],
				}),
			],
			findings: [
				f("f1", "evidence", { source: "prometheus" }),
				f("f2", "evidence", { source: "prometheus" }),
			],
		});
		const result = gradeReport(report);
		expect(
			result.gaps.some((g) => g.criterion === "corroboration-satisfied"),
		).toBe(true);
	});
});

describe("isNewInformation (D0.4)", () => {
	const base: ProgressSnapshot = {
		findingIds: ["f1"],
		hypothesisStatuses: { h1: "proposed" },
		hypothesisConfidence: { h1: 0.5 },
		openCoverageGaps: 2,
	};

	it("no change → false", () => {
		expect(isNewInformation(base, { ...base })).toBe(false);
	});

	it("detects each of the four kinds of progress", () => {
		expect(isNewInformation(base, { ...base, findingIds: ["f1", "f2"] })).toBe(
			true,
		);
		expect(
			isNewInformation(base, {
				...base,
				hypothesisStatuses: { h1: "testing" },
			}),
		).toBe(true);
		expect(
			isNewInformation(base, { ...base, hypothesisConfidence: { h1: 0.7 } }),
		).toBe(true);
		expect(isNewInformation(base, { ...base, openCoverageGaps: 1 })).toBe(true);
	});
});
