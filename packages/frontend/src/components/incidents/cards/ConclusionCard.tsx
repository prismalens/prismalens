// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HYPOTHESIS_STATUS_LABEL } from "@prismalens/contracts";
import { FidelityBadge } from "@/components/investigation/ReportSections";
import { InlineMarkdown } from "@/components/shared/AgentMarkdown";
import { StateChip } from "@/components/shared/StateChip";
import { hypothesisStatusTone } from "@/lib/state-tone";
import { useIncidentRecord } from "../record-context";
import { Card, CardLink } from "./Card";

/**
 * What the agent concluded, from the same report object the Report route
 * renders (#743 §3c.2): the culprit sentence and the top hypothesis.
 */
export function ConclusionCard() {
	const { incident } = useIncidentRecord();
	const cause = incident.actualCause ?? incident.actualCauseCategory;
	return (
		<>
			{cause && (
				<Card title="Actual cause" testId="actual-cause">
					<p className="text-record">
						{incident.actualCause && incident.actualCauseCategory && (
							<span className="text-muted-foreground">
								{incident.actualCauseCategory}:{" "}
							</span>
						)}
						<InlineMarkdown text={cause} />
					</p>
				</Card>
			)}
			<AgentConclusion />
		</>
	);
}

function AgentConclusion() {
	const { incident, run, investigationId } = useIncidentRecord();
	const investigation = run.investigation;
	const state = run.state;

	// Nothing to conclude yet, or nothing will be: the card stays away (#743).
	if (!investigationId || !investigation || !state) return null;
	if (state === "starting" || state === "working" || state === "stopping") {
		return (
			<Card title="Conclusion" testId="conclusion-card">
				<p className="text-record text-muted-foreground">Nothing yet</p>
			</Card>
		);
	}
	if (state !== "done") return null;

	const report = investigation.report ?? null;
	const top = report?.hypotheses[0];
	const refuted =
		report?.hypotheses.filter((h) => h.status === "refuted").length ?? 0;
	const culprit = investigation.rootCause ?? report?.rootCause ?? null;

	return (
		<Card
			title="Conclusion"
			testId="conclusion-card"
			aside={
				<>
					{report?.fidelity && <FidelityBadge fidelity={report.fidelity} />}
					<CardLink
						incidentId={incident.id}
						to="report"
						testId="conclusion-read-report"
					>
						Read the report
					</CardLink>
				</>
			}
		>
			<p className="line-clamp-2 text-record font-medium">
				{culprit ?? "The investigation finished without naming a root cause."}
			</p>
			{top && (
				<div className="flex min-w-0 items-center gap-2 text-meta">
					<StateChip tone={hypothesisStatusTone(top.status)}>
						{HYPOTHESIS_STATUS_LABEL[top.status]}
					</StateChip>
					<span className="min-w-0 flex-1 truncate" title={top.statement}>
						<InlineMarkdown text={top.statement} />
					</span>
					<span className="shrink-0 text-muted-foreground tabular-nums">
						{top.evidence.length} evidence
						{refuted > 0 ? `, ${refuted} refuted` : ""}
					</span>
				</div>
			)}
		</Card>
	);
}
