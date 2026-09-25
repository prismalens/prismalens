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
		expect(md).toContain(
			"Run: opencode, read-only mode, cooperative: permission policy",
		);
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

	it("names the agent's version and where the model came from", () => {
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
				},
			},
			completedAt: null,
		});
		expect(md).toContain(
			"Run: opencode 1.18.30, model gemma4:31b (set in Settings), read-only mode, cooperative: permission policy",
		);
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
