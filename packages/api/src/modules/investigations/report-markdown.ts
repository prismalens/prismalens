// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One Markdown rendering of a report (#606), shared by the export download and
 * the GitHub and Slack deliveries so the three never disagree.
 */

import type { Evidence, InvestigationReport } from "@prismalens/contracts";
import {
	EVIDENCE_DIRECTION_LABEL,
	EVIDENCE_STATUS_LABEL,
	HYPOTHESIS_STATUS_LABEL,
	MODEL_SOURCE_LABEL,
	ROOT_CAUSE_CATEGORY_LABEL,
} from "@prismalens/contracts";

export interface ReportMarkdownInput {
	incident: { number: number; title: string };
	report: InvestigationReport;
	completedAt: Date | null;
}

function evidenceLines(evidence: Evidence[]): string[] {
	return evidence.map(
		(e) =>
			`  - ${EVIDENCE_DIRECTION_LABEL[e.direction]} (${EVIDENCE_STATUS_LABEL[e.status]}): ${e.observation} — \`${e.source}\``,
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
			? ` (${ROOT_CAUSE_CATEGORY_LABEL[report.rootCauseCategory]})`
			: "";
		out.push(`## Root cause${category}`, "", report.rootCause, "");
	}

	if (report.hypotheses.length > 0) {
		out.push("## Hypotheses", "");
		report.hypotheses.forEach((h, i) => {
			out.push(
				`${i + 1}. **${h.statement}** (${HYPOTHESIS_STATUS_LABEL[h.status]})`,
			);
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
		const agent = f.harnessVersion
			? `${f.harness} ${f.harnessVersion}`
			: f.harness;
		const model = f.model
			? `, model ${f.model}${f.modelSource ? ` (${MODEL_SOURCE_LABEL[f.modelSource]})` : ""}`
			: "";
		out.push(
			"---",
			"",
			`Run: ${agent}${model}, ${f.mode} mode, ${f.fidelity}: ${f.mechanism}`,
			"",
		);
	}
	return out.join("\n");
}

export function reportFilename(incidentNumber: number): string {
	return `INC-${incidentNumber}-report.md`;
}
