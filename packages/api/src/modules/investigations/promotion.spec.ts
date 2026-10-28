// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { meetsPromotionRule } from "./promotion.js";

type Hypothesis = InvestigationReport["hypotheses"][number];
type Evidence = Hypothesis["evidence"][number];

const evidence = (status: Evidence["status"], direction: Evidence["direction"]): Evidence => ({
	observation: "p99 is 4 s",
	source: "curl prometheus",
	status,
	direction,
});

const report = (...hypotheses: Hypothesis[]) => ({ hypotheses }) as Pick<InvestigationReport, "hypotheses">;
const hypothesis = (status: Hypothesis["status"], ...e: Evidence[]): Hypothesis => ({
	statement: "The pool is exhausted",
	status,
	evidence: e,
});

describe("meetsPromotionRule (#979, adversary OBJ-010)", () => {
	it.each(["confirmed", "supported"] as const)("%s with verified supporting evidence promotes", (status) => {
		expect(meetsPromotionRule(report(hypothesis(status, evidence("verified", "supports"))))).toBe(true);
	});

	it("one verified supporting item among others is enough", () => {
		expect(
			meetsPromotionRule(
				report(hypothesis("supported", evidence("inferred", "supports"), evidence("verified", "contradicts"), evidence("verified", "supports"))),
			),
		).toBe(true);
	});

	it.each([
		["inferred-only evidence", hypothesis("confirmed", evidence("inferred", "supports"))],
		["verified but contradicting evidence", hypothesis("confirmed", evidence("verified", "contradicts"))],
		["a refuted hypothesis with verified support", hypothesis("refuted", evidence("verified", "supports"))],
		["a speculative hypothesis with verified support", hypothesis("speculative", evidence("verified", "supports"))],
		["a confirmed hypothesis with no evidence", hypothesis("confirmed")],
	])("%s does not promote", (_name, h) => {
		expect(meetsPromotionRule(report(h))).toBe(false);
	});

	it("needs the status and the evidence on the same hypothesis", () => {
		expect(
			meetsPromotionRule(
				report(hypothesis("supported", evidence("inferred", "supports")), hypothesis("refuted", evidence("verified", "supports"))),
			),
		).toBe(false);
	});

	it("does not promote on no hypotheses, and ignores the culprit", () => {
		expect(meetsPromotionRule(report())).toBe(false);
		expect(meetsPromotionRule({ hypotheses: [], culprit: { statement: "a bad deploy" } } as never)).toBe(false);
		expect(meetsPromotionRule(null)).toBe(false);
	});
});
