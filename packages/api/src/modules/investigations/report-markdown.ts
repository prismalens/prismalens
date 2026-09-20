// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One Markdown rendering of a report (#606), shared by the export download and
 * the GitHub and Slack deliveries so the three never disagree.
 */

import type { Evidence, InvestigationReport } from "@prismalens/contracts";

export interface ReportMarkdownInput {
	incident: { number: number; title: string };
	report: InvestigationReport;
	completedAt: Date | null;
}

function evidenceLines(evidence: Evidence[]): string[] {
	return evidence.map(
		(e) =>
			`  - ${e.direction === "contradicts" ? "Against" : "For"} (${e.status}): ${e.observation} — \`${e.source}\``,
	);
}

export function reportToMarkdown({
	incident,
	report,
	completedAt,
}: ReportMarkdownInput): string {
	const out: string[] = [`# INC-${incident.number}: ${incident.title}`, ""];
	if (completedAt) {
		out.push(`Investigation completed ${completedAt.toISOString()}.`, "");
	}
	out.push("## Summary", "", report.summary, "");

	if (report.rootCause) {
		const category = report.rootCauseCategory
			? ` (${report.rootCauseCategory})`
			: "";
		out.push(`## Root cause${category}`, "", report.rootCause, "");
	}

	if (report.hypotheses.length > 0) {
		out.push("## Hypotheses", "");
		report.hypotheses.forEach((h, i) => {
			out.push(`${i + 1}. **${h.statement}** (${h.status})`);
			out.push(...evidenceLines(h.evidence));
		});
		out.push("");
	}

	if (report.ruledOut.length > 0) {
		out.push("## Ruled out", "");
		for (const r of report.ruledOut) {
			out.push(`- **${r.statement}**: ${r.why}`);
			out.push(...evidenceLines(r.evidence));
		}
		out.push("");
	}

	if (report.nextSteps.length > 0) {
		out.push("## Next steps", "");
		for (const step of report.nextSteps) {
			const priority = step.priority ? ` [${step.priority}]` : "";
			out.push(`- **${step.title}**${priority}: ${step.detail}`);
		}
		out.push("");
	}

	const { queried, notQueried } = report.coverage;
	if (queried.length > 0 || notQueried.length > 0) {
		out.push("## Coverage", "");
		if (queried.length > 0) out.push(`- Queried: ${queried.join(", ")}`);
		if (notQueried.length > 0) {
			out.push(`- Not queried: ${notQueried.join(", ")}`);
		}
		out.push("");
	}

	if (report.fidelity) {
		const f = report.fidelity;
		out.push(
			"---",
			"",
			`Run: ${f.harness}${f.model ? ` (${f.model})` : ""}, ${f.mode} mode, ${f.fidelity}: ${f.mechanism}`,
			"",
		);
	}
	return out.join("\n");
}

export function reportFilename(incidentNumber: number): string {
	return `INC-${incidentNumber}-report.md`;
}
