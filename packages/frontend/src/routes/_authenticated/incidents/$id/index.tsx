/**
 * The Overview tab (study-v3 §3.3): the incident in a sentence and the next
 * step, then Report, Alerts and Timeline, each heading the way to its tab. The
 * facts sit in the rail from 1280 and in one details line below it.
 */

import {
	ROOT_CAUSE_CATEGORY_LABEL,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	useIncidentFacts,
	useRanWithoutRepo,
} from "@/components/incidents/IncidentFacts";
import { NoteField } from "@/components/incidents/NoteField";
import {
	FactsRail,
	RecordPage,
	ROWS,
	TabSection,
} from "@/components/incidents/RecordLayout";
import { useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { TimelineList } from "@/components/incidents/TimelineList";
import { DockedComposer } from "@/components/investigation/DockedComposer";
import { InlineCode } from "@/components/shared/InlineCode";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { alertGroups } from "@/lib/alert-groups";
import { answerWord } from "@/lib/answer-word";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock } from "@/lib/format-time";
import { attentionFor } from "@/lib/incident-attention";
import { incidentLineage } from "@/lib/incident-board";
import { incidentSummary } from "@/lib/incident-summary";
import { runStepText } from "@/lib/investigation-events";
import { gapsOf } from "@/lib/report-view";
import { incidentServices } from "@/lib/service-lanes";
import { groupTimeline } from "@/lib/timeline-groups";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	component: IncidentOverview,
});

function IncidentOverview() {
	const { rail } = useIncidentFacts();
	return (
		<RecordPage
			testId="incident-record"
			rail={<FactsRail facts={rail} />}
			box={<DockedComposer className="bg-transparent px-0 pt-0 pb-0 sm:px-0" />}
		>
			<Summary />
			<Cause />
			<ReportBrief />
			<AlertsBrief />
			<TimelineBrief />
		</RecordPage>
	);
}

/** Where it stands in a sentence or two, and the one thing to do next on this screen. */
function Summary() {
	const record = useIncidentRecord();
	const { incident, runs, run } = record;
	const now = useNow(1000);
	const noRepo = useRanWithoutRepo(runs[0]?.id ?? null);
	const live =
		run.state === "starting" ||
		run.state === "working" ||
		run.state === "stopping";
	const step =
		live && now !== null
			? (runStepText(run.events, now)?.text ?? "starting")
			: null;
	// The selected run's own status is fresher than the incident's list of runs.
	const fresh = run.investigation;
	const { lines, next } = incidentSummary({
		now: now ?? Date.now(),
		alerts: incident.alerts ?? [],
		services: incidentServices(incident).map((s) => s.name),
		runs: runs.map((r) =>
			fresh && r.id === fresh.id ? { ...r, status: fresh.status } : r,
		),
		noRepo,
		attention: attentionFor(incident),
		step,
	});
	const lineage = incidentLineage(incident);
	const serviceId = incident.service?.id;
	return (
		<section aria-label="Summary" data-testid="incident-summary">
			{lineage && (
				<p
					className="mb-1 text-body text-text-2"
					data-testid="incident-lineage"
				>
					<span className="font-medium text-text-1">{lineage.lead}</span>{" "}
					{lineage.text}
				</p>
			)}
			<p className="text-title font-medium">
				<InlineCode text={lines.join(" ")} />
			</p>
			{next && (
				<p className="mt-1 text-body text-text-2" data-testid="incident-next">
					Next:{" "}
					{next.kind === "link-repo" && serviceId ? (
						<Link
							to="/services/$id"
							params={{ id: serviceId }}
							className="text-accent hover:underline"
						>
							{lower(next.text)}
						</Link>
					) : next.kind === "acknowledge" ? (
						<button
							type="button"
							onClick={record.acknowledge}
							className="text-accent hover:underline"
						>
							{lower(next.text)}
						</button>
					) : next.kind === "close" ? (
						<button
							type="button"
							onClick={record.openClose}
							className="text-accent hover:underline"
						>
							{lower(next.text)}
						</button>
					) : (
						lower(next.text)
					)}
				</p>
			)}
		</section>
	);
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The cause you recorded; on a reopened incident it reads as the previous one (R1a d4, d8). */
function Cause() {
	const { incident, openEditCause } = useIncidentRecord();
	const resolved = incident.status === "closed";
	const cause = incident.actualCause;
	const category = incident.actualCauseCategory
		? ROOT_CAUSE_CATEGORY_LABEL[incident.actualCauseCategory]
		: null;
	if (!resolved && !cause && !category) return null;
	return (
		<TabSection
			title={resolved ? "Cause" : "Previous cause"}
			testId={resolved ? "actual-cause" : "previous-cause"}
		>
			<div className="flex items-start gap-3">
				<p className="min-w-0 flex-1 text-body" data-testid="cause-text">
					{category && cause && (
						<span className="text-text-2">{category}: </span>
					)}
					{cause ?? category ?? "No cause recorded"}
				</p>
				{resolved && (
					<Button
						variant="text"
						size="sm"
						className="-my-0.5"
						onClick={openEditCause}
						data-testid="edit-cause"
					>
						Edit
					</Button>
				)}
			</div>
		</TabSection>
	);
}

function plural(n: number, one: string, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`;
}

/** The report in a line: its answer, or why there is none yet. */
function ReportBrief() {
	const { incident, run, investigationId } = useIncidentRecord();
	const inv = run.investigation;
	const who = useRunAgentModel(inv);
	const report = inv?.report ?? null;
	let body: React.ReactNode;
	if (!investigationId) body = "No investigation yet.";
	else if (!inv || !run.state) body = "Loading the run.";
	else if (run.state === "done" && report) {
		const { word, tone } = answerWord(report);
		const supported = report.hypotheses.filter(
			(h) => h.status === "supported" || h.status === "confirmed",
		).length;
		const gaps = gapsOf(report, run.events, inv.workspace?.cwd).length;
		body = (
			<>
				<p className="text-body">
					<StateWord tone={tone} className="mr-2 text-body">
						{word}
					</StateWord>
					<InlineCode text={report.rootCause ?? report.summary} />
				</p>
				<p className="mt-1 text-body text-text-3">
					{plural(supported, "supported finding")},{" "}
					{plural(
						gaps,
						"thing it could not check",
						"things it could not check",
					)}
					, {plural(report.nextSteps.length, "step")} to do.
				</p>
			</>
		);
	} else if (run.state === "failed")
		body = (
			<p className="text-body text-text-2">
				No report.{" "}
				<StateWord tone="danger" className="text-body">
					Run failed
				</StateWord>
				{inv.completedAt ? ` at ${formatClock(inv.completedAt)}` : ""}:{" "}
				{failureSentence(who.agent, inv.error).said}
			</p>
		);
	else if (run.state === "stopped")
		body = `No report. You stopped the run${inv.completedAt ? ` at ${formatClock(inv.completedAt)}` : ""}.`;
	else body = "The report comes when the run finishes.";
	return (
		<TabSection
			title="Report"
			to="report"
			incidentId={incident.id}
			testId="overview-report"
		>
			{typeof body === "string" ? (
				<p className="text-body text-text-2">{body}</p>
			) : (
				body
			)}
		</TabSection>
	);
}

/** When the last alert of a quiet group cleared; its last firing when none recorded it. */
function clearedAt(g: ReturnType<typeof alertGroups>[number]): number {
	const at = g.alerts.map((a) => (a.resolvedAt ? Date.parse(a.resolvedAt) : 0));
	return Math.max(...at) || Date.parse(g.lastAt);
}

/** The first few rules that fired, with their window; every alert is one tab away. */
function AlertsBrief() {
	const { incident } = useIncidentRecord();
	const groups = alertGroups(incident.alerts ?? []);
	return (
		<TabSection
			title="Alerts"
			count={incident.alertCount}
			to="alerts"
			incidentId={incident.id}
			testId="overview-alerts"
		>
			{groups.length === 0 ? (
				<p className="text-body text-text-2">No alerts are correlated yet.</p>
			) : (
				<ul className={ROWS}>
					{groups.slice(0, 3).map((g) => (
						<li key={g.name} data-testid="overview-alert">
							<span
								role="img"
								aria-label={SEVERITY_LABEL[g.severity]}
								className="mt-1.5 size-2 shrink-0 rounded-full"
								style={{ background: `var(--sev-${g.severity})` }}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-body">{g.name}</p>
								<p className="text-meta text-text-3">
									{g.firing > 0 ? (
										<>
											<StateWord tone="danger">Firing</StateWord> since{" "}
											{formatClock(g.firstAt)}
											{g.alerts.length > 1 ? `, ${g.alerts.length} alerts` : ""}
										</>
									) : (
										<>
											<StateWord tone="ok">Cleared</StateWord> at{" "}
											{formatClock(clearedAt(g))}, fired{" "}
											{formatClock(g.firstAt)}
										</>
									)}
								</p>
							</div>
						</li>
					))}
				</ul>
			)}
		</TabSection>
	);
}

/** The last few entries and the note field; the rest is the Timeline tab. */
function TimelineBrief() {
	const { incident, runs, timeline, timelineLoading } = useIncidentRecord();
	const shown = groupTimeline(timeline, runs).slice(0, 3);
	return (
		<TabSection
			title="Timeline"
			count={timeline.length}
			to="timeline"
			incidentId={incident.id}
			testId="overview-timeline"
		>
			{timelineLoading ? null : shown.length === 0 ? (
				<p className="mb-2 text-body text-text-2">Nothing recorded yet.</p>
			) : (
				<TimelineList items={shown} />
			)}
			<NoteField />
		</TabSection>
	);
}
