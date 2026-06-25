import { describe, expect, it } from "vitest";
import { parseReport } from "./report.js";

describe("parseReport — ordered-evidence contract (ADR-0002)", () => {
	it("orders hypotheses by rank and renumbers to 1..n", () => {
		const r = parseReport({
			summary: "s",
			hypotheses: [
				{ rank: 5, statement: "b", evidence: [] },
				{ rank: 2, statement: "a", evidence: [] },
			],
		});
		expect(r.hypotheses.map((h) => h.statement)).toEqual(["a", "b"]);
		expect(r.hypotheses.map((h) => h.rank)).toEqual([1, 2]);
	});

	it("never emits a numeric confidence/probability/score field", () => {
		const r = parseReport({
			summary: "s",
			hypotheses: [
				{ rank: 1, statement: "a", evidence: [{ observation: "o", source: "git", direction: "supports", status: "verified" }] },
			],
		});
		expect(JSON.stringify(r)).not.toMatch(/confidence|probability|score/i);
	});

	it("coerces missing/malformed input to safe defaults", () => {
		const r = parseReport({});
		expect(r.hypotheses).toEqual([]);
		expect(r.rootCause).toBeNull();
		expect(r.recommendations).toEqual([]);
	});

	it("coerces invalid evidence enums to safe defaults", () => {
		const r = parseReport({
			summary: "s",
			hypotheses: [
				{ rank: 1, statement: "a", evidence: [{ observation: "o", source: "x", direction: "maybe", status: "confident" }] },
			],
		});
		const ev = r.hypotheses[0]?.evidence[0];
		expect(ev?.direction).toBe("supports");
		expect(ev?.status).toBe("inferred");
	});

	it("treats hypotheses-as-string as empty (defensive parsing)", () => {
		const r = parseReport({ summary: "s", hypotheses: "oops" });
		expect(r.hypotheses).toEqual([]);
	});
});
