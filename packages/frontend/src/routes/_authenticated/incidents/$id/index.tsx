/**
 * The Overview tab (#673 w12, w13): the incident in a sentence and the next
 * step, then Report, Alerts and Timeline pools and the note field; no box.
 */

import {
	isRunStateLive,
	latestRun,
	ROOT_CAUSE_CATEGORY_LABEL,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRanWithoutRepo } from "@/components/incidents/IncidentFacts";
import { NoteField } from "@/components/incidents/NoteField";
import {
	RecordLink,
	RecordPage,
	ROWS,
	TabSection,
} from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";
import {
	runElapsed,
	runNumber,
	runTimed,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { TimelineList } from "@/components/incidents/TimelineList";
import {
	type InvestigationRun,
	useInvestigationRun,
} from "@/components/investigation/useInvestigationRun";
import { InlineCode } from "@/components/shared/InlineCode";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { alertGroups } from "@/lib/alert-groups";
import { answerWord } from "@/lib/answer-word";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock, formatElapsed } from "@/lib/format-time";
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
	const { runs, run, investigationId } = useIncidentRecord();
	const newest = latestRun({ investigations: runs });
	// The selected run is usually the newest; only a different one needs its own subscription.
	const other = useInvestigationRun(
		newest && newest.id !== investigationId ? newest.id : null,
	);
	const latest = newest && newest.id === investigationId ? run : other;
	return (
		<RecordPage testId="incident-record">
			<Summary latest={latest} />
			<ReportPool latest={latest} />
			<Cause />
			<AlertsPool />
			<TimelinePool />
			<NoteField />
		</RecordPage>
	);
}

/** Where it stands in a sentence or two, and the one thing to do next. */
function Summary({ latest }: { latest: InvestigationRun }) {
	const record = useIncidentRecord();
	const { incident, runs } = record;
	const now = useNow(1000);
	const noRepo = useRanWithoutRepo(runs[0]?.id ?? null);
	const live = !!latest.state && isRunStateLive(latest.state);
	const step =
		live && now !== null
			? (runStepText(latest.events, now)?.text ?? "starting")
			: null;
	const fresh = latest.investigation;
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
	const act = "text-accent hover:underline";
	return (
		<section
			aria-label="Summary"
			className="mb-4"
			data-testid="incident-summary"
		>
			{lineage && (
				<p
					className="mb-1 text-body text-text-2"
					data-testid="incident-lineage"
				>
					<span className="font-medium text-text-1">{lineage.lead}</span>{" "}
					{lineage.text}
				</p>
			)}
			<p className="mt-1 text-[15px] leading-[22px] font-semibold">
				<InlineCode text={lines.join(" ")} />
			</p>
			{next && (
				<p className="mt-1 text-body text-text-2" data-testid="incident-next">
					Next:{" "}
					{next.kind === "link-repo" && serviceId ? (
						<Link to="/services/$id" params={{ id: serviceId }} className={act}>
							{lower(next.text)}
						</Link>
					) : next.kind === "acknowledge" ? (
						<button type="button" onClick={record.acknowledge} className={act}>
							{lower(next.text)}
						</button>
					) : next.kind === "close" ? (
						<button type="button" onClick={record.openClose} className={act}>
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

function plural(n: number, one: string, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`;
}

/** The newest run in a line: working, its answer, its failure, or none yet (w13). */
function ReportPool({ latest }: { latest: InvestigationRun }) {
	const { incident, runs } = useIncidentRecord();
	const now = useNow(1000);
	const inv = latest.investigation;
	const who = useRunAgentModel(inv);
	const report = inv?.report ?? null;
	const n = inv ? runNumber(runs, inv.id) : 0;
	const took = inv && runTimed(inv) ? formatElapsed(runElapsed(inv, now)) : "";
	const live = !!latest.state && isRunStateLive(latest.state);
	const earlierReport = runs.some((r) => r.hasReport && r.id !== inv?.id);
	let body: React.ReactNode;
	if (runs.length === 0)
		body = (
			<p className="text-body text-text-2">
				No run yet. Start one with + New run.
			</p>
		);
	else if (!inv || !latest.state)
		body = <p className="text-body text-text-2">Loading the run.</p>;
	else if (live && !report)
		body = (
			<p className="flex items-center gap-2 text-body">
				<span aria-hidden className="h-3 w-[3px] rounded-full bg-live" />
				<span>
					Run #{n} working <span className="text-text-3">{took}</span>
				</span>
				<RecordLink
					incidentId={incident.id}
					to="conversation"
					search={{ investigation: inv.id }}
					className="ml-1"
					testId="overview-open-conversation"
				>
					Open the conversation
				</RecordLink>
			</p>
		);
	else if (latest.state === "failed")
		body = (
			<p className="text-body [overflow-wrap:anywhere]">
				<StateWord tone="danger" className="mr-2 text-body font-semibold">
					Run failed
				</StateWord>
				{inv.completedAt ? `at ${formatClock(inv.completedAt)} ` : ""}
				{took ? `after ${took}` : ""}:{" "}
				{failureSentence(who.agent, inv.error).said}
			</p>
		);
	else if (report) {
		const { word, tone } = answerWord(report);
		const supported = report.hypotheses.filter(
			(h) => h.status === "supported" || h.status === "confirmed",
		).length;
		const gaps = gapsOf(report, latest.events, inv.workspace?.cwd).length;
		body = (
			<>
				<p className="text-body">
					<StateWord tone={tone} className="mr-2 text-body font-semibold">
						{word}
					</StateWord>
					<InlineCode text={report.rootCause ?? report.summary} />
				</p>
				<p className="mt-1 text-meta text-text-2">
					{plural(supported, "supported finding")},{" "}
					{plural(
						gaps,
						"thing it could not check",
						"things it could not check",
					)}
					, {plural(report.nextSteps.length, "step")} to do.
				</p>
				{live && (
					<p className="mt-1 flex items-center gap-2 text-meta text-text-2">
						<span aria-hidden className="h-3 w-[3px] rounded-full bg-live" />
						<span>
							Run #{n} working on an answer{" "}
							<span className="text-text-3">{took}</span>
						</span>
						<RecordLink
							incidentId={incident.id}
							to="conversation"
							search={{ investigation: inv.id }}
							testId="overview-open-conversation"
						>
							Open the conversation
						</RecordLink>
					</p>
				)}
			</>
		);
	} else
		body = (
			<p className="text-body text-text-2">
				Run #{n} {latest.state === "stopped" ? "stopped by you" : "done"}
				{took ? ` after ${took}` : ""}. No report.
			</p>
		);
	return (
		<TabSection title="Report" testId="overview-report">
			{body}
			{runs.length > 0 && (
				<p className="mt-2 flex gap-3 text-meta text-text-3">
					<span>{plural(runs.length, "run")}</span>
					{(!live || earlierReport) && (
						<RecordLink
							incidentId={incident.id}
							to="report"
							testId="overview-report-heading"
						>
							Report
						</RecordLink>
					)}
				</p>
			)}
		</TabSection>
	);
}

/** The cause you recorded; on a reopened incident it reads as the previous one. */
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

function clearedAt(g: ReturnType<typeof alertGroups>[number]): number {
	const at = g.alerts.map((a) => (a.resolvedAt ? Date.parse(a.resolvedAt) : 0));
	return Math.max(...at) || Date.parse(g.lastAt);
}

/** The first few rules that fired; the dot is the alert's state, severity colour only while firing (w24). */
function AlertsPool() {
	const { incident } = useIncidentRecord();
	const groups = alertGroups(incident.alerts ?? []);
	return (
		<TabSection
			title="Alerts"
			count={incident.alertCount}
			to="alerts"
			action="All alerts"
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
								aria-label={`${SEVERITY_LABEL[g.severity]}, ${g.firing > 0 ? "firing" : "cleared"}`}
								className="mt-1.5 size-2 shrink-0 rounded-full"
								style={{
									background:
										g.firing > 0 ? `var(--sev-${g.severity})` : "var(--text-3)",
								}}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-body">{g.name}</p>
								<p className="text-meta text-text-2">
									{g.firing > 0
										? `Firing since ${formatClock(g.firstAt)}${g.alerts.length > 1 ? `, ${g.alerts.length} alerts` : ""}`
										: `Cleared at ${formatClock(clearedAt(g))}, fired ${formatClock(g.firstAt)}`}
								</p>
							</div>
						</li>
					))}
				</ul>
			)}
		</TabSection>
	);
}

/** The last five entries; the rest is the Timeline tab. */
function TimelinePool() {
	const { incident, runs, timeline, timelineLoading } = useIncidentRecord();
	const shown = groupTimeline(timeline, runs).slice(0, 5);
	return (
		<TabSection
			title="Timeline"
			count={timeline.length}
			to="timeline"
			action="All events"
			incidentId={incident.id}
			testId="overview-timeline"
		>
			{timelineLoading ? null : shown.length === 0 ? (
				<p className="text-body text-text-2">Nothing recorded yet.</p>
			) : (
				<TimelineList items={shown} />
			)}
		</TabSection>
	);
}
