// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { FindingsLedger, quoteLine, withFindings } from "./findings.js";
import { parseReport } from "./report.js";

const AT = "2026-10-28T10:00:00.000Z";
const LOG = "boot ok\nconnecting to db\nERROR pool exhausted: 50/50 in use\nretrying";

describe("quoteLine (#740: code resolves the quote to a line)", () => {
	it("finds a verbatim quote and names its line", () => {
		expect(quoteLine(LOG, "ERROR pool exhausted")).toBe(3);
	});
	it("matches a quote the agent re-wrapped", () => {
		expect(quoteLine(LOG, "connecting  to db\n  ERROR pool")).toBe(2);
	});
	it("never guesses: a paraphrase is not found", () => {
		expect(quoteLine(LOG, "the pool was exhausted")).toBeNull();
		expect(quoteLine(LOG, "   ")).toBeNull();
	});
	it("treats regex characters as text", () => {
		expect(quoteLine("a (b) [c] 50/50 $x", "(b) [c] 50/50 $x")).toBe(1);
		expect(quoteLine("abc", "a.c")).toBeNull();
	});
});

function ledger(): FindingsLedger {
	const l = new FindingsLedger();
	l.sawOutput("call-1", "old output: ERROR pool exhausted");
	l.sawOutput("call-2", LOG);
	return l;
}

describe("FindingsLedger (#930)", () => {
	it("anchors evidence to the newest output holding the quote", () => {
		const r = ledger().addEvidence(
			{ observation: "pool full", source: "kubectl logs api", quote: "ERROR pool exhausted", direction: "supports" },
			null,
			AT,
		);
		expect(r).toMatchObject({ id: "e1", anchor: { in: "tool-output", toolCallId: "call-2", line: 3 } });
	});

	it("keeps a quote no output holds unanchored, and anchors it once its output lands", () => {
		const l = ledger();
		const r = l.addEvidence(
			{ observation: "late", source: "curl", quote: "HTTP 503 upstream", direction: "supports" },
			null,
			AT,
		);
		expect(r).toMatchObject({ id: "e1", anchor: null });
		const anchored = l.sawOutput("call-3", "< HTTP 503 upstream");
		const at = { in: "tool-output", toolCallId: "call-3", line: 1 };
		expect(anchored).toEqual([expect.objectContaining({ id: "e1", anchor: at })]);
		expect(l.snapshot().evidence[0]?.anchor).toEqual(at);
		expect(l.sawOutput("call-4", "< HTTP 503 upstream")).toEqual([]);
	});

	it("restores what an earlier turn recorded, and numbers on after it", () => {
		const l = new FindingsLedger();
		l.restore({
			evidence: [{ id: "e1", observation: "o", source: "s", quote: "q quote", direction: "supports", anchor: null, at: AT }],
			hypotheses: [{ id: "rh1", statement: "pool", status: "speculative", evidenceIds: ["e1"], at: AT }],
		});
		expect(l.addEvidence({ observation: "p", source: "s", quote: "never", direction: "supports" }, null, AT)).toMatchObject({ id: "e2" });
		expect(l.addHypothesis({ id: "rh1", statement: "pool", status: "confirmed" }, AT)).toMatchObject({ evidenceIds: ["e1"] });
	});

	it("with a path, only the caller's file lookup counts; the outputs are not searched", () => {
		const r = ledger().addEvidence(
			{ observation: "x", source: "src/db.ts", quote: "ERROR pool exhausted", direction: "supports", path: "src/db.ts" },
			null,
			AT,
		);
		expect(r).toMatchObject({ anchor: null, path: "src/db.ts" });
	});

	it("refuses a hypothesis naming evidence nobody recorded", () => {
		const r = ledger().addHypothesis({ statement: "pool", status: "supported", evidence: ["e9"] }, AT);
		expect(r).toEqual({ error: "No recorded evidence e9; record it with evidence_record first" });
	});

	it("updates a hypothesis by id: evidence given replaces the links, left out keeps them", () => {
		const l = ledger();
		for (const quote of ["ERROR pool exhausted", "retrying"])
			l.addEvidence({ observation: quote, source: "logs", quote, direction: "supports" }, null, AT);
		l.addHypothesis({ statement: "pool", status: "speculative", evidence: ["e1"] }, AT);
		const kept = l.addHypothesis({ id: "rh1", statement: "pool exhausted", status: "supported" }, AT);
		expect(kept).toMatchObject({ id: "rh1", status: "supported", evidenceIds: ["e1"] });
		const swapped = l.addHypothesis({ id: "rh1", statement: "pool exhausted", status: "confirmed", evidence: ["e2"] }, AT);
		expect(swapped).toMatchObject({ evidenceIds: ["e2"] });
		expect(l.snapshot().hypotheses).toHaveLength(1);
		expect(l.addHypothesis({ id: "rh7", statement: "x", status: "speculative" }, AT)).toHaveProperty("error");
	});
});

const base: Omit<InvestigationReport, "fidelity"> = {
	summary: "pool",
	rootCause: "pool exhausted",
	rootCauseCategory: null,
	hypotheses: [
		{
			statement: "Pool exhausted",
			status: "confirmed",
			evidence: [{ observation: "pool full", source: "logs", direction: "supports", status: "verified" }],
		},
	],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
	nextSteps: [],
};

describe("withFindings (#930: the report is the final answer plus what was recorded)", () => {
	it("an agent that recorded nothing keeps its final answer", () => {
		expect(withFindings(base, { evidence: [], hypotheses: [] })).toBe(base);
	});

	it("joins a recorded hypothesis to the answer's by statement; the recorded evidence's status is what code found", () => {
		const l = ledger();
		l.addEvidence({ observation: "pool full", source: "logs", quote: "a quote nowhere", direction: "supports" }, null, AT);
		l.addEvidence({ observation: "50/50 in use", source: "logs", quote: "50/50 in use", direction: "supports" }, null, AT);
		l.addHypothesis({ statement: "pool  exhausted", status: "supported", evidence: ["e1", "e2"] }, AT);
		l.addHypothesis({ statement: "DNS flake", status: "refuted", evidence: [] }, AT);
		const out = withFindings(base, l.snapshot());
		expect(out.hypotheses).toHaveLength(2);
		const [pool, dns] = out.hypotheses;
		expect(pool?.status).toBe("confirmed");
		expect(pool?.evidence).toEqual([
			expect.objectContaining({ observation: "pool full", status: "inferred", anchor: null, quote: "a quote nowhere" }),
			expect.objectContaining({
				observation: "50/50 in use",
				status: "verified",
				toolCallId: "call-2",
				anchor: { in: "tool-output", toolCallId: "call-2", line: 3 },
			}),
		]);
		expect(dns).toMatchObject({ id: "rh2", statement: "DNS flake", status: "refuted", evidence: [] });
	});

	it("evidence recorded with no hypothesis still replaces the answer's copy, in hypotheses and ruled-out causes", () => {
		const l = ledger();
		l.addEvidence({ observation: "Pool  FULL", source: "logs", quote: "ERROR pool exhausted", direction: "supports" }, null, AT);
		const out = withFindings(
			{
				...base,
				ruledOut: [
					{
						statement: "DNS",
						why: "resolved fine",
						evidence: [{ observation: "pool full", source: "x", direction: "contradicts", status: "verified" }],
					},
				],
			},
			l.snapshot(),
		);
		const anchored = expect.objectContaining({ status: "verified", toolCallId: "call-2", quote: "ERROR pool exhausted" });
		expect(out.hypotheses[0]?.evidence).toEqual([anchored]);
		expect(out.ruledOut[0]?.evidence).toEqual([anchored]);
	});

	it("an answer numbering its own hypotheses h1, h2 does not join a recorded one by accident", () => {
		const l = ledger();
		l.addHypothesis({ statement: "Stale cache", status: "speculative" }, AT);
		const answer = { ...base, hypotheses: [{ ...base.hypotheses[0], id: "h1" } as InvestigationReport["hypotheses"][number]] };
		const out = withFindings(answer, l.snapshot());
		expect(out.hypotheses.map((h) => [h.id, h.statement])).toEqual([
			["h1", "Pool exhausted"],
			["rh1", "Stale cache"],
		]);
	});

	it("a file anchor becomes a path:line source the run view opens", () => {
		const out = withFindings(
			{ ...base, hypotheses: [] },
			{
				evidence: [
					{
						id: "e1",
						observation: "max 50",
						source: "config",
						quote: "max: 50",
						direction: "supports",
						path: "repo/db.yaml",
						anchor: { in: "file", path: "/w/repo/db.yaml", line: 4 },
						at: AT,
					},
				],
				hypotheses: [{ id: "rh1", statement: "pool", status: "supported", evidenceIds: ["e1"], at: AT }],
			},
		);
		expect(out.hypotheses[0]?.evidence[0]).toMatchObject({ source: "/w/repo/db.yaml:4 (config)", status: "verified", toolCallId: null });
	});

	it("a report the model writes cannot carry an anchor of its own", () => {
		const report = {
			...base,
			hypotheses: [
				{
					statement: "x",
					status: "confirmed",
					evidence: [
						{
							observation: "o",
							source: "s",
							direction: "supports",
							status: "verified",
							quote: "q",
							anchor: { in: "file", path: "/etc/passwd", line: 1 },
						},
					],
				},
			],
		};
		const parsed = parseReport(`\`\`\`json\n${JSON.stringify(report)}\n\`\`\``);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.report.hypotheses[0]?.evidence[0]).not.toHaveProperty("anchor");
	});
});
