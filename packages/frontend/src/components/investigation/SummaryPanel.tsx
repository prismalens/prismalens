// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HYPOTHESIS_STATUS_LABEL } from "@prismalens/contracts";
import { useState } from "react";
import { Card, CardLink } from "@/components/incidents/cards/Card";
import { CardStack } from "@/components/incidents/cards/CardStack";
import { NoteField } from "@/components/incidents/cards/NoteField";
import {
	newestFirst,
	TimelineRows,
} from "@/components/incidents/cards/TimelineCard";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { Segmented } from "@/components/shared/Segmented";
import { StateChip } from "@/components/shared/StateChip";
import { hypothesisStatusTone } from "@/lib/state-tone";

type PanelTab = "summary" | "report" | "timeline";

/**
 * The conversation route's side panel (#743 §3c): the incident page's cards,
 * the report's hypotheses, or the timeline, so steering keeps the picture.
 */
export function SummaryPanel({ className }: { className?: string }) {
	const [tab, setTab] = useState<PanelTab>("summary");
	return (
		<aside className={className} data-testid="summary-panel">
			<div className="flex h-10 shrink-0 items-center px-3">
				<Segmented
					label="Panel"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "summary", label: "Summary" },
						{ value: "report", label: "Report" },
						{ value: "timeline", label: "Timeline" },
					]}
					testId="summary-panel-tab"
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex flex-col gap-2 p-3">
					{tab === "summary" && <CardStack inPanel />}
					{tab === "report" && <ReportPanel />}
					{tab === "timeline" && <TimelinePanel />}
				</div>
			</div>
		</aside>
	);
}

function ReportPanel() {
	const { incident, run } = useIncidentRecord();
	const investigation = run.investigation;
	const report = investigation?.report ?? null;
	if (run.state !== "done" || !investigation) {
		return (
			<Card title="Report">
				<p className="text-record text-muted-foreground">
					Lands here when the run finishes.
				</p>
			</Card>
		);
	}
	return (
		<Card
			title="Report"
			aside={
				<CardLink incidentId={incident.id} to="report">
					Open the report
				</CardLink>
			}
		>
			<p className="text-record font-medium">
				{investigation.rootCause ??
					report?.rootCause ??
					"The run finished without naming a root cause."}
			</p>
			<ul className="space-y-1">
				{report?.hypotheses.map((h) => (
					<li
						key={h.statement}
						className="flex min-w-0 items-center gap-2 text-meta"
					>
						<StateChip tone={hypothesisStatusTone(h.status)}>
							{HYPOTHESIS_STATUS_LABEL[h.status]}
						</StateChip>
						<span className="min-w-0 flex-1 truncate" title={h.statement}>
							{h.statement}
						</span>
						<span className="shrink-0 text-muted-foreground tabular-nums">
							{h.evidence.length} evidence
						</span>
					</li>
				))}
			</ul>
			{report?.nextSteps[0] && (
				<p className="text-meta text-muted-foreground">
					Next: {report.nextSteps[0].title}
				</p>
			)}
		</Card>
	);
}

function TimelinePanel() {
	const { timeline } = useIncidentRecord();
	return (
		<Card title="Timeline" count={timeline.length}>
			<NoteField />
			<TimelineRows entries={newestFirst(timeline).slice(0, 6)} />
		</Card>
	);
}
