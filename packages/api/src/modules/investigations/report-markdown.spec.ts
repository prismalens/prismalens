// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts";
import { InvestigationReportSchema } from "@prismalens/contracts";
import { reportFilename, reportToMarkdown } from "./report-markdown.js";

const REPORT: InvestigationReport = {
	summary: "checkout-api exhausted its connection pool after deploy 41.",
	rootCause: "Pool size dropped from 50 to 5 in deploy 41.",
	rootCauseCategory: "config",
	hypotheses: [
		{
			statement: "Pool size misconfigured",
			status: "confirmed",
			evidence: [
				{
					observation: "DB_POOL_SIZE=5 in the new manifest",
					source: "git show 41:deploy.yaml",
					direction: "supports",
					status: "verified",
				},
			],
		},
	],
	ruledOut: [
		{
			statement: "Database outage",
			why: "Primary answered throughout",
			evidence: [
				{
					observation: "No failover events",
					source: "logs",
					direction: "contradicts",
					status: "inferred",
				},
			],
		},
	],
	coverage: { queried: ["git", "logs"], notQueried: ["metrics"] },
	nextSteps: [
		{ title: "Restore pool size", detail: "Set it back to 50", priority: "high" },
	],
	fidelity: {
		harness: "opencode",
		mode: "read-only",
		fidelity: "cooperative",
		mechanism: "permission policy",
	},
};

describe("reportToMarkdown", () => {
	it("renders every section in order", () => {
		const md = reportToMarkdown({
			incident: { number: 7, title: "Checkout 500s" },
			report: REPORT,
			completedAt: new Date("2026-09-19T10:00:00Z"),
		});
		expect(md).toContain("# INC-7: Checkout 500s");
		expect(md).toContain("Investigation completed 2026-09-19T10:00:00.000Z.");
		expect(md).toContain("## Root cause (Configuration)");
		expect(md).toContain("1. **Pool size misconfigured** (Confirmed)");
		expect(md).toContain(
			"  - For (Verified): DB_POOL_SIZE=5 in the new manifest — `git show 41:deploy.yaml`",
		);
		expect(md).toContain("- **Database outage**: Primary answered throughout");
		expect(md).toContain("  - Against (Inferred): No failover events — `logs`");
		expect(md).toContain("- **Restore pool size** [high]: Set it back to 50");
		expect(md).toContain("- Not queried: metrics");
		const order = [
			"## Summary",
			"## Root cause",
			"## Hypotheses",
			"## Ruled out",
			"## Next steps",
			"## Coverage",
		].map((h) => md.indexOf(h));
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it("carries the actual cause a person recorded, after the root cause (#673 w41)", () => {
		const md = reportToMarkdown({
			incident: {
				number: 7,
				title: "Checkout 500s",
				actualCause: "A cron job held every pool connection",
				actualCauseCategory: "infrastructure",
				closedAt: new Date("2026-09-20T08:00:00Z"),
			},
			report: REPORT,
			completedAt: null,
		});
		expect(md).toContain(
			"## Actual cause (recorded by a person)\n\nA cron job held every pool connection\n\nCategory: Infrastructure. Recorded on close, 2026-09-20T08:00:00.000Z.\n",
		);
		expect(md.indexOf("## Actual cause")).toBeGreaterThan(md.indexOf("## Root cause"));
		expect(md.indexOf("## Actual cause")).toBeLessThan(md.indexOf("## Hypotheses"));
	});

	it("says where a merged incident went, under the heading (#673 w37)", () => {
		const md = reportToMarkdown({
			incident: { number: 9, title: "Orders 500s", mergedInto: { number: 4 } },
			report: REPORT,
			completedAt: null,
		});
		expect(md.startsWith("# INC-9: Orders 500s\n\nMerged into INC-4.\n")).toBe(true);
	});

	it("has no actual-cause section when none was recorded", () => {
		const md = reportToMarkdown({
			incident: { number: 7, title: "Checkout 500s", actualCause: null },
			report: REPORT,
			completedAt: null,
		});
		expect(md).not.toContain("Actual cause");
	});

	it("names no agent or model, whatever ran it (#673 w58)", () => {
		const md = reportToMarkdown({
			incident: { number: 7, title: "Checkout 500s" },
			report: {
				...REPORT,
				fidelity: {
					harness: "opencode",
					mode: "read-only",
					fidelity: "cooperative",
					mechanism: "permission policy",
					harnessVersion: "1.18.30",
					model: "gemma4:31b",
					modelSource: "operator",
					servedModel: "gemma3:12b",
				},
			},
			completedAt: null,
		});
		expect(md).not.toMatch(/^Run:/m);
		expect(md).not.toMatch(/opencode|gemma|Settings/);
	});

	it("omits empty sections", () => {
		const md = reportToMarkdown({
			incident: { number: 1, title: "t" },
			report: {
				...REPORT,
				rootCause: null,
				rootCauseCategory: null,
				hypotheses: [],
				ruledOut: [],
				nextSteps: [],
				coverage: { queried: [], notQueried: [] },
				fidelity: null,
			},
			completedAt: null,
		});
		expect(md).toBe(`# INC-1: t\n\n## Summary\n\n${REPORT.summary}\n`);
	});
});

describe("reportFilename", () => {
	it("names the incident", () => {
		expect(reportFilename(12)).toBe("INC-12-report.md");
	});
});

/**
 * The export route validates the persisted blob rather than casting it: a row
 * written by an older schema must read as "no report" (404), not throw inside
 * the renderer at `hypotheses` or `coverage` (CodeRabbit on #661).
 */
describe("a persisted report that no longer matches the schema", () => {
	it("fails InvestigationReportSchema rather than rendering", () => {
		const stale = { summary: "only a summary survived" };

		expect(InvestigationReportSchema.safeParse(stale).success).toBe(false);
		expect(() =>
			reportToMarkdown({
				incident: { number: 1, title: "t" },
				report: stale as unknown as InvestigationReport,
				completedAt: null,
			}),
		).toThrow();
	});
});
